const http = require("http");
const soap = require("soap");
const path = require("path");
const logger = require("./log-manager");
const DeviceService = require("./services/device-service");
const MediaService = require("./services/media-service");

class OnvifServer {
    constructor(camera) {
        this.camera = camera;

        this.deviceService = new DeviceService(camera);
        this.mediaService = new MediaService(camera);
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
                    DeviceService: this.deviceService.getServiceDefinition()
                }
            };

            const mediaServiceDef = {
                MediaService: {
                    MediaService: this.mediaService.getServiceDefinition()
                }
            };

            server.listen(this.camera.onvifPort, this.camera.ip, () => {
                logger.info(
                    `HTTP listener ready for ${this.camera.name} on ${this.camera.ip}:${this.camera.onvifPort}`
                );

                soap.listen(server, "/onvif/device_service", deviceServiceDef, wsdlDevice);
                soap.listen(server, "/onvif/media_service", mediaServiceDef, wsdlMedia);

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
