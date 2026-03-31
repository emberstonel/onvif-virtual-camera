// src/services/discovery-service.js
const dgram = require("dgram");
const logger = require("../log-manager");

const MULTICAST_ADDRESS = "239.255.255.250";
const DISCOVERY_PORT = 3702;

class DiscoveryService {
    constructor(camera) {
        this.camera = camera;
        this.socket = null;
        this.responseSocket = null;
        this.running = false;

        this.endpointAddress = this.buildEndpointAddress();
        this.xaddr = this.buildXAddr();
    }

    getDiscoveryScopes() {
        const manufacturer = this.camera.identity?.manufacturer || "";
        const model = this.camera.identity?.model || "";
        const discoveryName = [manufacturer, model].filter(Boolean).join(" ") || this.camera.name;
        const scopes = [
            "onvif://www.onvif.org/type/video_encoder",
            `onvif://www.onvif.org/name/${this.escapeScope(discoveryName)}`,
            `onvif://www.onvif.org/hardware/${this.escapeScope(this.camera.identity.model)}`,
            `onvif://www.onvif.org/location/${this.escapeScope((this.camera.host && this.camera.host.hostname) || "virtual")}`
        ];

        return scopes.join("\n          ");
    }

    buildEndpointAddress() {
        const macClean = this.camera.mac.toLowerCase().replace(/[^0-9a-f]/g, "");
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

    buildXAddr() {
        return this.camera.endpoints.deviceServiceUrl;
    }

    start() {
        return new Promise((resolve, reject) => {
            if (this.running) {
                return resolve();
            }

            let settled = false;
            const rejectStartup = (err) => {
                if (settled) {
                    return;
                }

                settled = true;

                try {
                    this.socket?.close();
                } catch (_) {
                    // Ignore cleanup errors during failed startup.
                }

                try {
                    this.responseSocket?.close();
                } catch (_) {
                    // Ignore cleanup errors during failed startup.
                }

                this.socket = null;
                this.responseSocket = null;
                this.running = false;
                this.camera.lifecycle.discoveryReady = false;
                reject(err);
            };

            const resolveStartup = () => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve();
            };

            this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
            this.responseSocket = dgram.createSocket({ type: "udp4", reuseAddr: false });

            this.socket.on("error", (err) => {
                logger.error(`WS-Discovery socket error for ${this.camera.name} (${this.camera.ip}): ${err.message}`);
                if (!this.running) {
                    rejectStartup(err);
                }
            });

            this.responseSocket.on("error", (err) => {
                logger.error(`WS-Discovery response socket error for ${this.camera.name} (${this.camera.ip}): ${err.message}`);
                if (!this.running) {
                    rejectStartup(err);
                }
            });

            this.socket.on("message", (msg, rinfo) => {
                try {
                    this.handleMessage(msg, rinfo);
                } catch (err) {
                    logger.error(`WS-Discovery message handling error for ${this.camera.name} (${this.camera.ip}): ${err.message}`);
                }
            });

            this.responseSocket.bind(0, this.camera.ip, () => {
                this.socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
                    try {
                        this.socket.addMembership(MULTICAST_ADDRESS, this.camera.ip);
                        this.socket.setMulticastInterface(this.camera.ip);
                    } catch (err) {
                        logger.error(`Failed to join multicast group on ${this.camera.ip} for ${this.camera.name}: ${err.message}`);
                        rejectStartup(err);
                        return;
                    }

                    this.running = true;
                    this.camera.lifecycle.discoveryReady = true;

                    logger.debug('discovery',
                        `WS-Discovery listening for ${this.camera.name} on 0.0.0.0:${DISCOVERY_PORT} ` +
                        `(reply source ${this.camera.ip}, XAddr: ${this.xaddr})`
                    );

                    resolveStartup();
                });
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (!this.running || !this.socket) {
                return resolve();
            }

            const finalizeStop = () => {
                logger.info(`WS-Discovery stopped for ${this.camera.name} on ${this.camera.ip}`);
                this.running = false;
                this.camera.lifecycle.discoveryReady = false;
                this.socket = null;
                this.responseSocket = null;
                resolve();
            };

            this.socket.close(() => {
                if (!this.responseSocket) {
                    finalizeStop();
                    return;
                }

                this.responseSocket.close(() => {
                    finalizeStop();
                });
            });
        });
    }

    handleMessage(msg, rinfo) {
        const xml = msg.toString("utf8");

        // Very simple filter: only respond to Probe messages
        if (!xml.includes("<d:Probe") && !xml.includes("<Probe")) {
            return;
        }

        logger.debug('discovery',
            `WS-Discovery Probe received for ${this.camera.name} from ${rinfo.address}:${rinfo.port} ` +
            `(endpoint=${this.endpointAddress}, xaddr=${this.xaddr}, mac=${this.camera.mac}, ip=${this.camera.ip})`
        );

        const probeTypes = this.extractProbeTypes(xml);
        if (probeTypes) {
            logger.debug("discovery",
                `WS-Discovery Probe Types for ${this.camera.name}: ${probeTypes}`
            );
        }

        const relatesTo = this.extractMessageId(xml);
        const responseXml = this.buildProbeMatchesResponse(relatesTo);

        const buf = Buffer.from(responseXml, "utf8");
        const responseSocket = this.responseSocket || this.socket;
        responseSocket.send(buf, 0, buf.length, rinfo.port, rinfo.address, (err) => {
            if (err) {
                logger.error(
                    `Failed to send ProbeMatches for ${this.camera.name} to ${rinfo.address}:${rinfo.port} - ${err.message}`
                );
            } else {
                logger.debug('discovery',
                    `ProbeMatches sent for ${this.camera.name} to ${rinfo.address}:${rinfo.port} ` +
                    `(endpoint=${this.endpointAddress}, xaddr=${this.xaddr}, mac=${this.camera.mac}, ip=${this.camera.ip})`
                );
            }
        });
    }

buildProbeMatchesResponse(relatesTo) {
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
          <wsa:Address>${this.endpointAddress}</wsa:Address>
        </wsa:EndpointReference>
        <wsd:Types>dn:NetworkVideoTransmitter</wsd:Types>
        <wsd:Scopes>
          ${this.getDiscoveryScopes()}
        </wsd:Scopes>
        <wsd:XAddrs>${this.xaddr}</wsd:XAddrs>
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

module.exports = DiscoveryService;
