const logger = require("../log-manager");

class DeviceService {
    constructor({ name, model, mac, ip }) {
        this.name = name;
        this.model = model;
        this.mac = mac.toLowerCase();
        this.ip = ip;
    }

    // ONVIF: GetDeviceInformation
    async GetDeviceInformation() {
        return {
            Manufacturer: "VirtualCam",
            Model: this.model,
            FirmwareVersion: "1.0",
            SerialNumber: this.mac.replace(/:/g, "").toUpperCase(),
            HardwareId: this.mac.replace(/:/g, "").toUpperCase()
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
                    XAddr: `http://${this.ip}/onvif/device_service`
                },
                Media: {
                    XAddr: `http://${this.ip}/onvif/media_service`
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
                    XAddr: `http://${this.ip}/onvif/device_service`,
                    Version: { Major: 1, Minor: 0 }
                },
                {
                    Namespace: "http://www.onvif.org/ver10/media/wsdl",
                    XAddr: `http://${this.ip}/onvif/media_service`,
                    Version: { Major: 1, Minor: 0 }
                }
            ]
        };
    }
}

module.exports = DeviceService;
