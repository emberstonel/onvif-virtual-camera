// src/onvif-server.js
const fs = require("fs");
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

    mergeTypesXsd(wsdlXml, xsdXml) {
        const schemaBody = xsdXml
            .replace(/^\s*<\?xml[^>]*>\s*/i, "")
            .match(/<xs:schema\b[^>]*>([\s\S]*?)<\/xs:schema>/i)?.[1];

        if (!schemaBody) {
            throw new Error("types.xsd content does not contain a valid <xs:schema> block");
        }

        const merged = wsdlXml.replace(
            /<xs:import\b[^>]*schemaLocation=["']types\.xsd["'][^>]*\/>\s*/i,
            schemaBody
        );

        if (merged === wsdlXml) {
            throw new Error("types.xsd import not found in WSDL");
        }

        return merged;
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

        const token = security.UsernameToken;
        if (!token) {
            logger.warn(`SOAP auth missing UsernameToken for ${this.camera.name}`);
            return false;
        }

        logger.debug(`SOAP UsernameToken keys for ${this.camera.name}: ${Object.keys(token).join(", ")}`);

        const username = token.Username;
        const passwordValue = token.Password;
        const passwordType = typeof passwordValue;
        const nonce = token.Nonce ?? passwordValue?.Nonce;
        const created = token.Created ?? passwordValue?.Created;
        const passwordText = typeof passwordValue === "string"
            ? passwordValue
            : passwordValue?.$value ?? passwordValue?._ ?? passwordValue?.value;

        logger.debug(
            `SOAP auth attempt for ${this.camera.name}: ` +
            `username=${username || "<missing>"}, ` +
            `hasPassword=${passwordValue !== undefined}, ` +
            `passwordType=${passwordType}, ` +
            `hasNonce=${nonce !== undefined}, ` +
            `hasCreated=${created !== undefined}`
        );

        if (passwordValue && typeof passwordValue === "object") {
            logger.debug(`SOAP Password object keys for ${this.camera.name}: ${Object.keys(passwordValue).join(", ")}`);
        }

        if (username !== this.camera.auth.username) {
            logger.debug(`SOAP auth attempt for ${this.camera.name}: username=${username}, accepted=false (username mismatch)`);
            return false;
        }

        if (typeof passwordValue === "string") {
            const accepted = passwordValue === this.camera.auth.password;
            logger.debug(`SOAP auth attempt for ${this.camera.name}: username=${username}, accepted=${accepted}, mode=PasswordText`);
            return accepted;
        }

        if (passwordValue && typeof passwordValue === "object") {
            const crypto = require("crypto");
            const passwordTypeUri = passwordValue.Type || passwordValue.type || "";
            const digestValue = passwordText;

            if (!digestValue || !nonce || !created) {
                logger.warn(`SOAP auth digest missing required fields for ${this.camera.name}`);
                return false;
            }

            let nonceBuffer;
            try {
                nonceBuffer = Buffer.from(nonce, "base64");
            } catch (err) {
                logger.warn(`SOAP auth digest nonce decode failed for ${this.camera.name}: ${err.message}`);
                return false;
            }

            const expectedDigest = crypto
                .createHash("sha1")
                .update(Buffer.concat([
                    nonceBuffer,
                    Buffer.from(created, "utf8"),
                    Buffer.from(this.camera.auth.password, "utf8")
                ]))
                .digest("base64");

            const accepted = digestValue === expectedDigest;

            logger.debug(
                `SOAP auth attempt for ${this.camera.name}: ` +
                `username=${username}, accepted=${accepted}, mode=PasswordDigest, type=${passwordTypeUri || "<unknown>"}`
            );

            return accepted;
        }

        logger.warn(`SOAP auth unsupported password format for ${this.camera.name}`);
        return false;
    }

    async start() {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                if (req.url && (req.url.startsWith("/onvif/device_service") || req.url.startsWith("/onvif/media_service"))) {
                    return;
                }

                res.statusCode = 404;
                res.end("Not Found");
            });

            server.on("clientError", (err, socket) => {
                logger.error(`HTTP clientError for ${this.camera.name}: ${err.message}`);
            });
            server.prependListener("request", (req, res) => {
                logger.debug(`HTTP request for ${this.camera.name}: ${req.method} ${req.url} from ${req.socket.remoteAddress}`
                );
            });

            const wsdlFolder = path.resolve(__dirname, 'wsdl');
            const typesXsdPath = path.join(wsdlFolder, 'types.xsd');
            const deviceWsdlPath = path.join(wsdlFolder, 'device_service.wsdl');
            const mediaWsdlPath = path.join(wsdlFolder, 'media_service.wsdl');
            const typesXsdXml = fs.readFileSync(typesXsdPath, 'utf8');
            const deviceWsdlXml = this.mergeTypesXsd(fs.readFileSync(deviceWsdlPath, 'utf8'), typesXsdXml);
            const mediaWsdlXml = this.mergeTypesXsd(fs.readFileSync(mediaWsdlPath, 'utf8'), typesXsdXml);

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
                    forceSoap12Headers: true,
                    attributesKey: '$attributes',
                    wsdl_options: {
                        attributesKey: '$attributes'
                    }
                });
                const mediaSoapServer = soap.listen(server, {
                    path: "/onvif/media_service",
                    services: mediaServiceDef,
                    xml: mediaWsdlXml,
                    forceSoap12Headers: true,
                    attributesKey: '$attributes',
                    wsdl_options: {
                        attributesKey: '$attributes'
                    }
                });

                deviceSoapServer.authenticate = (security) => this.authenticateRequest(security);
                mediaSoapServer.authenticate = (security) => this.authenticateRequest(security);

                deviceSoapServer.on("request", (xml, methodName) => {
                    logger.debug(`SOAP Device request received for ${this.camera.name}: ${methodName}`);
                });
                deviceSoapServer.on("error", (err) => {
                    logger.error(`SOAP Device error for ${this.camera.name}: ${err.message}`);
                });
                mediaSoapServer.on("request", (xml, methodName) => {
                    logger.debug(`SOAP Media request received for ${this.camera.name}: ${methodName}`);
                });
                mediaSoapServer.on("error", (err) => {
                    logger.error(`SOAP Media error for ${this.camera.name}: ${err.message}`);
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