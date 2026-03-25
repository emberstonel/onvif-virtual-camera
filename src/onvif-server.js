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

        this.deviceService = new DeviceService(camera);
        this.mediaService = new MediaService(camera);
        this.discoveryService = new DiscoveryService(camera);
    }

    async start() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                res.end("ONVIF service endpoint");
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
                logger.info(
                    `HTTP listener ready for ${this.camera.name} on ${this.camera.ip}:${this.camera.onvifPort}`
                );

                const deviceSoapServer = soap.listen(server, "/onvif/device_service", deviceServiceDef, wsdlDevice);
                const mediaSoapServer = soap.listen(server, "/onvif/media_service", mediaServiceDef, wsdlMedia);

                deviceSoapServer.on("request", (xml, methodName) => {
                    logger.debug(`Device SOAP request received for ${this.camera.name}: ${methodName}`);
                });

                mediaSoapServer.on("request", (xml, methodName) => {
                    logger.debug(`Media SOAP request received for ${this.camera.name}: ${methodName}`);
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
                logger.error(
                    `ONVIF server error for ${this.camera.name}: ${err.message}`
                );
                reject(err);
            });
        });
    }
}

module.exports = OnvifServer;