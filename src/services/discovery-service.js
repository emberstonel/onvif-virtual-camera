// src/services/discovery-service.js
const dgram = require("dgram");
const logger = require("../log-manager");

const MULTICAST_ADDRESS = "239.255.255.250";
const DISCOVERY_PORT = 3702;

class DiscoveryService {
    constructor(camera) {
        this.camera = camera;
        this.socket = null;
        this.running = false;

        // Deterministic UUID based on MAC + IP
        this.endpointAddress = this.buildEndpointAddress();
        this.xaddr = this.buildXAddr();
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
        const port = this.camera.onvifPort || 80;
        return `http://${this.camera.ip}:${port}/onvif/device_service`;
    }

    start() {
        return new Promise((resolve, reject) => {
            if (this.running) {
                return resolve();
            }

            this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

            this.socket.on("error", (err) => {
                logger.error(
                    `WS-Discovery socket error for ${this.camera.name} (${this.camera.ip}): ${err.message}`
                );
            });

            this.socket.on("message", (msg, rinfo) => {
                try {
                    this.handleMessage(msg, rinfo);
                } catch (err) {
                    logger.error(
                        `WS-Discovery message handling error for ${this.camera.name} (${this.camera.ip}): ${err.message}`
                    );
                }
            });

            this.socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
                try {
                    this.socket.addMembership(MULTICAST_ADDRESS, this.camera.ip);
                    this.socket.setMulticastInterface(this.camera.ip);
                } catch (err) {
                    logger.error(
                        `Failed to join multicast group on ${this.camera.ip} for ${this.camera.name}: ${err.message}`
                    );
                }

                this.running = true;

                logger.info(
                    `WS-Discovery listening for ${this.camera.name} on ${this.camera.ip}:${DISCOVERY_PORT} (XAddr: ${this.xaddr})`
                );

                resolve();
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (!this.running || !this.socket) {
                return resolve();
            }

            this.socket.close(() => {
                logger.info(
                    `WS-Discovery stopped for ${this.camera.name} on ${this.camera.ip}`
                );
                this.running = false;
                this.socket = null;
                resolve();
            });
        });
    }

    handleMessage(msg, rinfo) {
        const xml = msg.toString("utf8");

        // Very simple filter: only respond to Probe messages
        if (!xml.includes("<d:Probe") && !xml.includes("<Probe")) {
            return;
        }

        logger.debug(
            `WS-Discovery Probe received for ${this.camera.name} from ${rinfo.address}:${rinfo.port} ` +
            `(endpoint=${this.endpointAddress}, xaddr=${this.xaddr}, mac=${this.camera.mac}, ip=${this.camera.ip})`
        );

        // Optional: filter by Types/Scopes if needed
        // For now, respond to all Probes

        const relatesTo = this.extractMessageId(xml);
        const responseXml = this.buildProbeMatchesResponse(relatesTo);

        const buf = Buffer.from(responseXml, "utf8");
        this.socket.send(buf, 0, buf.length, rinfo.port, rinfo.address, (err) => {
            if (err) {
                logger.error(
                    `Failed to send ProbeMatches for ${this.camera.name} to ${rinfo.address}:${rinfo.port} - ${err.message}`
                );
            } else {
                logger.debug(
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
          onvif://www.onvif.org/type/video_encoder
          onvif://www.onvif.org/name/${this.escapeScope(this.camera.name)}
          onvif://www.onvif.org/hardware/${this.escapeScope(this.camera.model)}
          onvif://www.onvif.org/location/${this.escapeScope((this.camera.host && this.camera.host.hostname) || "virtual")}
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
        // Replace spaces and unsafe chars with underscores
        return String(value).replace(/[^A-Za-z0-9_\-]/g, "_");
    }

    extractMessageId(xml) {
        const match = xml.match(/<[^:>]*:?MessageID[^>]*>([^<]+)<\/[^:>]*:?MessageID>/i);
        return match ? match[1].trim() : null;
    }
}

module.exports = DiscoveryService;
