const xml2js = require("xml2js");
const logger = require("../log-manager");

class SoapService {
    constructor({ deviceService, mediaService, wsdl }) {
        this.deviceService = deviceService;
        this.mediaService = mediaService;

        this.wsdl = wsdl;

        this.parser = new xml2js.Parser({
            explicitArray: false,
            ignoreAttrs: false
        });

        this.builder = new xml2js.Builder({
            headless: true,
            renderOpts: { pretty: false }
        });
    }

    async handle(xml) {
        let parsed;

        try {
            parsed = await this.parser.parseStringPromise(xml);
        } catch (err) {
            logger.error(`SOAP parse error: ${err.message}`);
            throw new Error("Invalid SOAP XML");
        }

        const body = parsed["Envelope"]?.["Body"];
        if (!body) {
            logger.error("SOAP envelope missing Body element");
            throw new Error("Invalid SOAP envelope");
        }

        const actionName = Object.keys(body)[0];
        if (!actionName) {
            logger.error("SOAP action not found in request");
            throw new Error("SOAP action not found");
        }

        logger.info(`Routing SOAP action: ${actionName}`);

        const response = await this.routeAction(actionName, body[actionName]);

        return this.wrapResponse(actionName + "Response", response);
    }

    async routeAction(actionName, payload) {
        switch (actionName) {
            // Device Service
            case "GetDeviceInformation":
                return this.deviceService.GetDeviceInformation();

            case "GetSystemDateAndTime":
                return this.deviceService.GetSystemDateAndTime();

            case "GetCapabilities":
                return this.deviceService.GetCapabilities();

            case "GetServices":
                return this.deviceService.GetServices();

            // Media Service
            case "GetProfiles":
                return this.mediaService.GetProfiles();

            case "GetStreamUri":
                return this.mediaService.GetStreamUri();

            case "GetSnapshotUri":
                return this.mediaService.GetSnapshotUri();

            case "GetVideoSources":
                return this.mediaService.GetVideoSources();

            case "GetVideoSourceConfiguration":
                return this.mediaService.GetVideoSourceConfiguration();

            case "GetVideoEncoderConfiguration":
                return this.mediaService.GetVideoEncoderConfiguration();

            default:
                logger.warn(`Unsupported SOAP action received: ${actionName}`);
                return {}; // Safe no-op response
        }
    }

    wrapResponse(actionName, bodyObj) {
        const envelope = {
            Envelope: {
                $: {
                    "xmlns:soap": "http://www.w3.org/2003/05/soap-envelope",
                    "xmlns:tds": "http://www.onvif.org/ver10/device/wsdl",
                    "xmlns:trt": "http://www.onvif.org/ver10/media/wsdl"
                },
                Body: {
                    [actionName]: bodyObj
                }
            }
        };

        return this.builder.buildObject(envelope);
    }
}

module.exports = SoapService;
