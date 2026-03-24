const logger = require("../log-manager");

class DeviceService {
    constructor(camera) {
        this.camera = camera;
    }

    // ONVIF: GetDeviceInformation
    async GetDeviceInformation() {
        return {
            Manufacturer: "VirtualCam",
            Model: this.camera.model || this.camera.name,
            FirmwareVersion: "1.0",
            SerialNumber: this.camera.mac.replace(/:/g, "").toUpperCase(),
            HardwareId: this.camera.mac.replace(/:/g, "").toUpperCase()
        };
    }

    // ONVIF: GetSystemDateAndTime
    async GetSystemDateAndTime() {
        const now = new Date();

        return {
            SystemDateAndTime: {
                DateTimeType: "NTP",
                DaylightSavings: false,
                TimeZone: { TZ: "UTC" },
                UTCDateTime: {
                    Time: {
                        Hour: now.getUTCHours(),
                        Minute: now.getUTCMinutes(),
                        Second: now.getUTCSeconds()
                    },
                    Date: {
                        Year: now.getUTCFullYear(),
                        Month: now.getUTCMonth() + 1,
                        Day: now.getUTCDate()
                    }
                }
            }
        };
    }

    // ONVIF: GetCapabilities
    async GetCapabilities() {
        return {
            Capabilities: {
                Device: {
                    XAddr: `http://${this.camera.ip}/onvif/device_service`
                },
                Media: {
                    XAddr: `http://${this.camera.ip}/onvif/media_service`
                }
            }
        };
    }

    // ONVIF: GetServices
    async GetServices() {
        return {
            Service: [
                {
                    Namespace: "http://www.onvif.org/ver10/device/wsdl",
                    XAddr: `http://${this.camera.ip}/onvif/device_service`,
                    Version: { Major: 1, Minor: 0 }
                },
                {
                    Namespace: "http://www.onvif.org/ver10/media/wsdl",
                    XAddr: `http://${this.camera.ip}/onvif/media_service`,
                    Version: { Major: 1, Minor: 0 }
                }
            ]
        };
    }

    GetServiceDefinition() {
        return {
            GetDeviceInformation: this.GetDeviceInformation.bind(this),
            GetSystemDateAndTime: this.GetSystemDateAndTime.bind(this),
            GetCapabilities: this.GetCapabilities.bind(this),
            GetServices: this.GetServices.bind(this)
        };
    }

}

module.exports = DeviceService;
