const logger = require("../log-manager");

class DeviceService {
    constructor(camera) {
        this.camera = camera;
    }

    buildDeviceCapabilities() {
        return {
            XAddr: this.camera.endpoints.deviceServiceUrl,
            System: {
                SupportedVersions: {
                    Major: 2,
                    Minor: 5
                },
            },
            Security: {
                TLS11: false,
                TLS12: false,
                OnboardKeyGeneration: false,
                AccessPolicyConfig: false,
                X509Token: false,
                SAMLToken: false,
                KerberosToken: false,
                RELToken: false,
                Extension: {
                    TLS10: false,
                    Dot1X: false,
                    RemoteUserHandling: false
                }
            }
        };
    }

    buildMediaCapabilities() {
        return {
            XAddr: this.camera.endpoints.mediaServiceUrl,
            StreamingCapabilities: {
                RTPMulticast: false,
                RTP_TCP: true,
                RTP_RTSP_TCP: true
            },
            Extension: {
                ProfileCapabilities: {
                    MaximumNumberOfProfiles: 1
                }
            }
        };
    }

    // ONVIF: GetDeviceInformation
    async GetDeviceInformation() {
        return {
            Manufacturer: this.camera.identity.manufacturer,
            Model: this.camera.identity.model,
            FirmwareVersion: this.camera.identity.firmwareVersion,
            SerialNumber: this.camera.identity.serialNumber,
            HardwareId: this.camera.identity.hardwareId
        };
    }

    // ONVIF: GetSystemDateAndTime
    async GetSystemDateAndTime() {
        const now = new Date();

        return {
            SystemDateAndTime: {
                DateTimeType: "NTP",
                DaylightSavings: false,
                TimeZone: {
                    TZ: "UTC"
                },
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
                },
                LocalDateTime: {
                    Time: {
                        Hour: now.getHours(),
                        Minute: now.getMinutes(),
                        Second: now.getSeconds()
                    },
                    Date: {
                        Year: now.getFullYear(),
                        Month: now.getMonth() + 1,
                        Day: now.getDate()
                    }
                }
            }
        };
    }

    // ONVIF: GetCapabilities
    async GetCapabilities(args) {
        const category = args && args.Category;
        const requested = Array.isArray(category)
            ? category
            : category
                ? [category]
                : [];

        const allRequested = requested.length === 0 || requested.includes("All");
        const includeDevice = allRequested || requested.includes("Device");
        const includeMedia = allRequested || requested.includes("Media");

        const capabilities = {};

        if (includeDevice) {
            capabilities.Device = this.buildDeviceCapabilities();
        }

        if (includeMedia) {
            capabilities.Media = this.buildMediaCapabilities();
        }

        logger.debug('device', 
            `GetCapabilities called for ${this.camera.name} ` +
            `(Category=${JSON.stringify(category)})`
        );

        return {
            Capabilities: capabilities
        };
    }

    // ONVIF: GetServices
    async GetServices(args) {
        const includeCapability = !!(args && args.IncludeCapability);

        const services = [
            {
                Namespace: "http://www.onvif.org/ver10/device/wsdl",
                XAddr: this.camera.endpoints.deviceServiceUrl,
                Version: {
                    Major: 2,
                    Minor: 5
                }
            },
            {
                Namespace: "http://www.onvif.org/ver10/media/wsdl",
                XAddr: this.camera.endpoints.mediaServiceUrl,
                Version: {
                    Major: 2,
                    Minor: 5
                }
            }
        ];

        if (includeCapability) {
            services[0].Capabilities = this.buildDeviceCapabilities();
            services[1].Capabilities = this.buildMediaCapabilities();
        }

        logger.debug('device',`GetServices called for ${this.camera.name} ` + `(IncludeCapability=${includeCapability})`);

        return {
            Service: services
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
