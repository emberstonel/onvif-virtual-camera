// src/onvif-server.js
const http = require("http");
const soap = require("soap");
const path = require("path");
const fs = require("fs");
const logger = require("./log-manager");
const DeviceService = require("./services/device-service");
const MediaService = require("./services/media-service");
const DiscoveryService = require("./services/discovery-service");

class OnvifServer {
    constructor(camera) {
        this.camera = camera;

        this.hasAuth = !!(
            this.camera.auth &&
            this.camera.auth.username &&
            this.camera.auth.password
        );

        this.deviceService = new DeviceService(camera);
        this.mediaService = new MediaService(camera);
        this.discoveryService = new DiscoveryService(camera);
    }

    authenticateRequest(security) {
        if (!this.hasAuth) {
            console.error(`[AUTH] disabled for ${this.camera.name}`);
            return true;
        }

        if (!security) {
            console.error(`[AUTH] missing security object for ${this.camera.name}`);
            return false;
        }

        console.error(`[AUTH] security keys ${this.camera.name}: ${Object.keys(security).join(", ")}`);

        const token = security.UsernameToken;
        if (!token) {
            console.error(`[AUTH] missing UsernameToken for ${this.camera.name}`);
            return false;
        }

        console.error(`[AUTH] UsernameToken keys ${this.camera.name}: ${Object.keys(token).join(", ")}`);

        console.error(
            `[AUTH] attempt ${this.camera.name} username=${token.Username} ` +
            `hasPassword=${token.Password !== undefined} ` +
            `passwordType=${typeof token.Password} ` +
            `hasNonce=${token.Nonce !== undefined} ` +
            `hasCreated=${token.Created !== undefined}`
        );

        const accepted =
            token.Username === this.camera.auth.username &&
            token.Password === this.camera.auth.password;

        console.error(`[AUTH] accepted=${accepted} camera=${this.camera.name}`);

        return accepted;
    }

    async start() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                console.error(`[HTTP] ${this.camera.name} ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

                if (
                    req.url &&
                    (
                        req.url.startsWith("/onvif/device_service") ||
                        req.url.startsWith("/onvif/media_service")
                    )
                ) {
                    return;
                }

                res.statusCode = 404;
                res.end("Not Found");
            });

            server.on("clientError", (err) => {
                console.error(`[HTTP-CLIENT-ERROR] ${this.camera.name} ${err.message}`);
            });

            const deviceWsdlXml = fs.readFileSync(
                path.join(__dirname, "wsdl", "device_service.wsdl"),
                "utf8"
            );

            const mediaWsdlXml = fs.readFileSync(
                path.join(__dirname, "wsdl", "media_service.wsdl"),
                "utf8"
            );

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

                const deviceSoapServer = soap.listen(server, {
                    path: "/onvif/device_service",
                    services: deviceServiceDef,
                    xml: deviceWsdlXml,
                    forceSoap12Headers: true
                });

                const mediaSoapServer = soap.listen(server, {
                    path: "/onvif/media_service",
                    services: mediaServiceDef,
                    xml: mediaWsdlXml,
                    forceSoap12Headers: true
                });

                deviceSoapServer.authenticate = (security) =>
                    this.authenticateRequest(security);

                mediaSoapServer.authenticate = (security) =>
                    this.authenticateRequest(security);

                deviceSoapServer.log = (type, data) => {
                    console.error(`[SOAP-DEVICE-LOG] ${this.camera.name} ${type}: ${data}`);
                };

                mediaSoapServer.log = (type, data) => {
                    console.error(`[SOAP-MEDIA-LOG] ${this.camera.name} ${type}: ${data}`);
                };

                deviceSoapServer.on("request", (xml, methodName) => {
                    console.error(`[SOAP-DEVICE] ${this.camera.name} ${methodName}`);
                });

                deviceSoapServer.on("error", (err) => {
                    console.error(
                        `[SOAP-DEVICE-ERR] ${this.camera.name} ${err && err.message}`
                    );
                });

                mediaSoapServer.on("request", (xml, methodName) => {
                    console.error(`[SOAP-MEDIA] ${this.camera.name} ${methodName}`);
                });

                mediaSoapServer.on("error", (err) => {
                    console.error(
                        `[SOAP-MEDIA-ERR] ${this.camera.name} ${err && err.message}`
                    );
                });

                try {
                    await this.discoveryService.start();
                } catch (err) {
                    logger.error(
                        `Failed to start WS-Discovery for ${this.camera.name}: ${err.message}`
                    );
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