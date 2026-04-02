const crypto = require("crypto");
const dgram = require("dgram");
const logger = require("./log-manager");

const MULTICAST_ADDRESS = "239.255.255.250";
const DISCOVERY_PORT = 3702;
const DEDUPE_TTL_MS = 1000;

class DiscoveryManager {
    constructor() {
        this.entries = new Map();
        this.recentProbes = new Map();
    }

    async startCamera(camera, onFatalError) {
        const existingEntry = this.entries.get(camera.mac);
        if (existingEntry?.running) {
            return;
        }

        const entry = this.createEntry(camera, onFatalError);
        this.entries.set(camera.mac, entry);

        try {
            await this.bindEntry(entry);
        } catch (err) {
            this.entries.delete(camera.mac);
            throw err;
        }
    }

    async stopCamera(camera) {
        const entry = this.entries.get(camera.mac);
        if (!entry) {
            return;
        }

        await this.closeEntry(entry);
        this.entries.delete(camera.mac);
    }

    createEntry(camera, onFatalError) {
        return {
            camera,
            onFatalError,
            socket: null,
            responseSocket: null,
            running: false,
            endpointAddress: this.buildEndpointAddress(camera),
            xaddr: this.buildXAddr(camera)
        };
    }

    bindEntry(entry) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const rejectStartup = (err) => {
                if (settled) {
                    return;
                }

                settled = true;

                try {
                    entry.socket?.close();
                } catch (_) {
                    // Ignore cleanup errors during failed startup.
                }

                try {
                    entry.responseSocket?.close();
                } catch (_) {
                    // Ignore cleanup errors during failed startup.
                }

                entry.socket = null;
                entry.responseSocket = null;
                entry.running = false;
                entry.camera.lifecycle.discoveryReady = false;
                reject(err);
            };

            const resolveStartup = () => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve();
            };

            entry.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
            entry.responseSocket = dgram.createSocket({ type: "udp4", reuseAddr: false });

            entry.socket.on("error", (err) => {
                logger.error(`WS-Discovery socket error for ${entry.camera.name} (${entry.camera.ip}): ${err.message}`);
                if (!entry.running) {
                    rejectStartup(err);
                    return;
                }
                entry.onFatalError?.(err);
            });

            entry.responseSocket.on("error", (err) => {
                logger.error(`WS-Discovery response socket error for ${entry.camera.name} (${entry.camera.ip}): ${err.message}`);
                if (!entry.running) {
                    rejectStartup(err);
                    return;
                }
                entry.onFatalError?.(err);
            });

            entry.socket.on("message", (msg, rinfo) => {
                try {
                    this.handleMessage(entry, msg, rinfo);
                } catch (err) {
                    logger.error(`WS-Discovery message handling error for ${entry.camera.name} (${entry.camera.ip}): ${err.message}`);
                }
            });

            entry.responseSocket.bind(0, entry.camera.ip, () => {
                entry.socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
                    try {
                        entry.socket.addMembership(MULTICAST_ADDRESS, entry.camera.ip);
                        entry.socket.setMulticastInterface(entry.camera.ip);
                    } catch (err) {
                        logger.error(`Failed to join multicast group on ${entry.camera.ip} for ${entry.camera.name}: ${err.message}`);
                        rejectStartup(err);
                        return;
                    }

                    entry.running = true;
                    entry.camera.lifecycle.discoveryReady = true;

                    logger.debug("discovery",
                        `WS-Discovery listening for ${entry.camera.name} on 0.0.0.0:${DISCOVERY_PORT} ` +
                        `(reply source ${entry.camera.ip}, XAddr: ${entry.xaddr})`
                    );

                    resolveStartup();
                });
            });
        });
    }

    closeEntry(entry) {
        return new Promise((resolve) => {
            if (!entry.running || !entry.socket) {
                entry.camera.lifecycle.discoveryReady = false;
                resolve();
                return;
            }

            const finalizeStop = () => {
                logger.info(`WS-Discovery stopped for ${entry.camera.name} on ${entry.camera.ip}`);
                entry.running = false;
                entry.camera.lifecycle.discoveryReady = false;
                entry.socket = null;
                entry.responseSocket = null;
                resolve();
            };

            entry.socket.close(() => {
                if (!entry.responseSocket) {
                    finalizeStop();
                    return;
                }

                entry.responseSocket.close(() => {
                    finalizeStop();
                });
            });
        });
    }

    handleMessage(entry, msg, rinfo) {
        const xml = msg.toString("utf8");

        // Very simple filter: only respond to Probe messages
        if (!xml.includes("<d:Probe") && !xml.includes("<Probe")) {
            return;
        }

        logger.debug("discovery",
            `WS-Discovery Probe received for ${entry.camera.name} from ${rinfo.address}:${rinfo.port} ` +
            `(endpoint=${entry.endpointAddress}, xaddr=${entry.xaddr}, mac=${entry.camera.mac}, ip=${entry.camera.ip})`
        );

        const probeTypes = this.extractProbeTypes(xml);
        if (probeTypes) {
            logger.debug("discovery",
                `WS-Discovery Probe Types for ${entry.camera.name}: ${probeTypes}`
            );
        }

        const relatesTo = this.extractMessageId(xml);
        if (this.isDuplicateProbe(entry, relatesTo, xml, rinfo)) {
            logger.debug("discovery",
                `Skipping duplicate Probe for ${entry.camera.name} from ${rinfo.address}:${rinfo.port} ` +
                `(messageId=${relatesTo || "<missing>"})`
            );
            return;
        }

        const responseXml = this.buildProbeMatchesResponse(entry, relatesTo);
        const buf = Buffer.from(responseXml, "utf8");
        const responseSocket = entry.responseSocket || entry.socket;
        responseSocket.send(buf, 0, buf.length, rinfo.port, rinfo.address, (err) => {
            if (err) {
                logger.error(
                    `Failed to send ProbeMatches for ${entry.camera.name} to ${rinfo.address}:${rinfo.port} - ${err.message}`
                );
            } else {
                logger.debug("discovery",
                    `ProbeMatches sent for ${entry.camera.name} to ${rinfo.address}:${rinfo.port} ` +
                    `(endpoint=${entry.endpointAddress}, xaddr=${entry.xaddr}, mac=${entry.camera.mac}, ip=${entry.camera.ip})`
                );
            }
        });
    }

    isDuplicateProbe(entry, messageId, xml, rinfo) {
        const fallbackId = crypto.createHash("sha1").update(xml, "utf8").digest("hex");
        const key = [
            entry.camera.mac,
            rinfo.address,
            rinfo.port,
            messageId || fallbackId
        ].join("|");
        const now = Date.now();

        for (const [recentKey, expiresAt] of this.recentProbes.entries()) {
            if (expiresAt <= now) {
                this.recentProbes.delete(recentKey);
            }
        }

        const expiresAt = this.recentProbes.get(key);
        if (expiresAt && expiresAt > now) {
            return true;
        }

        this.recentProbes.set(key, now + DEDUPE_TTL_MS);
        return false;
    }

    getDiscoveryScopes(camera) {
        const manufacturer = camera.identity?.manufacturer || "";
        const model = camera.identity?.model || "";
        const discoveryName = [manufacturer, model].filter(Boolean).join(" ") || camera.name;
        const scopes = [
            "onvif://www.onvif.org/type/video_encoder",
            `onvif://www.onvif.org/name/${this.escapeScope(discoveryName)}`,
            `onvif://www.onvif.org/hardware/${this.escapeScope(camera.identity.model)}`,
            `onvif://www.onvif.org/location/${this.escapeScope((camera.host && camera.host.hostname) || "virtual")}`
        ];

        return scopes.join("\n          ");
    }

    buildEndpointAddress(camera) {
        const macClean = camera.mac.toLowerCase().replace(/[^0-9a-f]/g, "");
        const padded = (macClean + "00000000000000000000000000000000").slice(0, 32);
        const uuid = [
            padded.slice(0, 8),
            padded.slice(8, 12),
            padded.slice(12, 16),
            padded.slice(16, 20),
            padded.slice(20, 32)
        ].join("-");
        return `urn:uuid:${uuid}`;
    }

    buildXAddr(camera) {
        return camera.endpoints.deviceServiceUrl;
    }

    buildProbeMatchesResponse(entry, relatesTo) {
        return `
<SOAP-ENV:Envelope
    xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"
    xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
    xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery"
    xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <SOAP-ENV:Header>
    <wsa:MessageID>urn:uuid:${this.generateSimpleId()}</wsa:MessageID>
    ${relatesTo ? `<wsa:RelatesTo>${relatesTo}</wsa:RelatesTo>` : ""}
    <wsa:To SOAP-ENV:mustUnderstand="true">
      http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous
    </wsa:To>
    <wsa:Action SOAP-ENV:mustUnderstand="true">
      http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches
    </wsa:Action>
    <wsd:AppSequence SOAP-ENV:mustUnderstand="true" InstanceId="1" MessageNumber="1" />
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <wsd:ProbeMatches>
      <wsd:ProbeMatch>
        <wsa:EndpointReference>
          <wsa:Address>${entry.endpointAddress}</wsa:Address>
        </wsa:EndpointReference>
        <wsd:Types>dn:NetworkVideoTransmitter</wsd:Types>
        <wsd:Scopes>
          ${this.getDiscoveryScopes(entry.camera)}
        </wsd:Scopes>
        <wsd:XAddrs>${entry.xaddr}</wsd:XAddrs>
        <wsd:MetadataVersion>1</wsd:MetadataVersion>
      </wsd:ProbeMatch>
    </wsd:ProbeMatches>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`.trim();
    }

    generateSimpleId() {
        // Not cryptographically strong, just unique enough for discovery messages
        const rand = Math.floor(Math.random() * 1e9).toString(16);
        const ts = Date.now().toString(16);
        return `${ts}-${rand}`;
    }

    escapeScope(value) {
        if (!value) return "";
        return encodeURIComponent(String(value));
    }

    extractMessageId(xml) {
        const match = xml.match(/<[^:>]*:?MessageID[^>]*>([^<]+)<\/[^:>]*:?MessageID>/i);
        return match ? match[1].trim() : null;
    }

    extractProbeTypes(xml) {
        const match = xml.match(/<[^:>]*:?Types[^>]*>([^<]+)<\/[^:>]*:?Types>/i);
        return match ? match[1].trim() : null;
    }
}

module.exports = DiscoveryManager;