// src/onvif-server.js
const http = require("http");
const soap = require("soap");
const path = require("path");
const logger = require("./log-manager");
const DeviceService = require("./services/device-service");
const MediaService = require("./services/media-service");
const DiscoveryService = require("./services/discovery-service");

class OnvifServer {
    constructor(camera) {
        this.camera = camera;
        this.hasAuth = !!(this.camera.auth && this.camera.auth.username && this.camera.auth.password);

        this.deviceService = new DeviceService(camera);
        this.mediaService = new MediaService(camera);
        this.discoveryService = new DiscoveryService(camera);
    }

    authenticateRequest(security) {
        if (!this.hasAuth) {
            logger.debug(`SOAP auth disabled for ${this.camera.name}`);
            return true;
        }
        if (!security) {
            logger.warn(`SOAP auth missing security object for ${this.camera.name}`);
            return false;
        }

        logger.debug(`SOAP auth security keys for ${this.camera.name}: ${Object.keys(security).join(", ")}`);

        const token = security && security.UsernameToken;
        if (!token) {
            logger.warn(`SOAP auth missing UsernameToken for ${this.camera.name}`);
            return false;
        }

        logger.debug(`SOAP UsernameToken keys for ${this.camera.name}: ${Object.keys(token).join(", ")}`);
        logger.debug(
            `SOAP auth attempt for ${this.camera.name}: ` +
            `username=${token.Username || "<missing>"}, ` +
            `hasPassword=${token.Password !== undefined}, ` +
            `passwordType=${typeof token.Password}, ` +
            `hasNonce=${token.Nonce !== undefined}, ` +
            `hasCreated=${token.Created !== undefined}`
        );
        if (token.Password && typeof token.Password === "object") {
            logger.debug(`SOAP Password object keys for ${this.camera.name}: ${Object.keys(token.Password).join(", ")}`);
        }

        const accepted = (token.Username === this.camera.auth.username && token.Password === this.camera.auth.password);

        logger.debug(`SOAP auth attempt for ${this.camera.name}: username=${token.Username}, accepted=${accepted}`);

        return accepted;
    }

    async start() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                logger.debug(`HTTP request for ${this.camera.name}: ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

                if (req.url.startsWith("/onvif/device_service") || req.url.startsWith("/onvif/media_service") {
                    return;
                }

                res.statusCode = 404;
                res.end("Not Found");
            });

            const wsdlDevice = path.join(__dirname, "wsdl", "device_service.wsdl");
            const wsdlMedia = path.join(__dirname, "wsdl", "media_service.wsdl");

            const deviceServiceDef = {
                DeviceService: {
                    DevicePort: this.deviceService.GetServiceDefinition()
                }
            };

            const mediaServiceDef = {
                MediaService: {
                    MediaPort: this.mediaService.GetServiceDefinition()
                }
            };

            server.listen(this.camera.onvifPort, this.camera.ip, async () => {
                logger.info(`HTTP listener ready for ${this.camera.name} on ${this.camera.ip}:${this.camera.onvifPort}`);

                const deviceSoapServer = soap.listen(server, "/onvif/device_service", deviceServiceDef, wsdlDevice);
                const mediaSoapServer = soap.listen(server, "/onvif/media_service", mediaServiceDef, wsdlMedia);

                deviceSoapServer.authenticate = (security) => this.authenticateRequest(security);
                mediaSoapServer.authenticate = (security) => this.authenticateRequest(security);

                deviceSoapServer.on("request", (xml, methodName) => {
                    logger.debug(`Device SOAP request received for ${this.camera.name}: ${methodName}`);
                });

                mediaSoapServer.on("request", (xml, methodName) => {
                    logger.debug(`Media SOAP request received for ${this.camera.name}: ${methodName}`);
                });

                try {
                    await this.discoveryService.start();
                } catch (err) {
                    logger.error(`Failed to start WS-Discovery for ${this.camera.name}: ${err.message}`);
                }

                resolve();
            });

            server.on("error", (err) => {
                logger.error(`ONVIF server error for ${this.camera.name}: ${err.message}`);
                reject(err);
            });
        });
    }
}

module.exports = OnvifServer;