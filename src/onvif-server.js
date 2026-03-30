// src/onvif-server.js
const fs = require("fs");
const http = require("http");
const soap = require("soap");
const path = require("path");
const logger = require("./log-manager");
const DeviceService = require("./services/device-service");
const MediaService = require("./services/media-service");
const DiscoveryService = require("./services/discovery-service");
const RtspProxyService = require("./services/rtsp-proxy-service");
const SnapshotService = require("./services/snapshot-service");

class OnvifServer {
    constructor(camera) {
        this.camera = camera;
        this.hasAuth = !!(this.camera.auth && this.camera.auth.username && this.camera.auth.password);
        this.lastSoapMethod = "unknown";
        this.httpServer = null;

        this.deviceService = new DeviceService(camera);
        this.mediaService = new MediaService(camera);
        this.discoveryService = new DiscoveryService(camera);
        this.rtspProxyService = new RtspProxyService(camera);
        this.snapshotService = new SnapshotService(camera);
    }

    logLifecycleState() {
        const lifecycle = this.camera.lifecycle;
        logger.debug("lifecycle",
            `Camera lifecycle ready for ${this.camera.name}: ` +
            `http=${lifecycle.httpReady}, snapshot=${lifecycle.snapshotReady}, ` +
            `rtsp=${lifecycle.rtspProxyReady}, discovery=${lifecycle.discoveryReady}`
        );
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
            logger.debug('auth', `SOAP auth disabled for ${this.camera.name}`);
            return true;
        }
        if (!security) {
            logger.warn(`SOAP auth missing security object for ${this.camera.name} (method=${this.lastSoapMethod})`);
            return false;
        }

        logger.debug('auth', `SOAP auth security keys for ${this.camera.name}: ${Object.keys(security).join(", ")}`);

        const token = security.UsernameToken;
        if (!token) {
            logger.warn(`SOAP auth missing UsernameToken for ${this.camera.name}`);
            return false;
        }

        logger.debug('auth', `SOAP UsernameToken keys for ${this.camera.name}: ${Object.keys(token).join(", ")}`);

        const username = token.Username;
        const passwordRaw = token.Password;
        const nonceRaw = token.Nonce;
        const createdRaw = token.Created;

        const passwordValue = typeof passwordRaw === "string"
            ? passwordRaw
            : passwordRaw?.$value ?? passwordRaw?._ ?? passwordRaw?.value;

        const nonceValue = typeof nonceRaw === "string"
            ? nonceRaw
            : nonceRaw?.$value ?? nonceRaw?._ ?? nonceRaw?.value;

        const createdValue = typeof createdRaw === "string"
            ? createdRaw
            : createdRaw?.$value ?? createdRaw?._ ?? createdRaw?.value;

        logger.debug('auth', 
            `SOAP auth attempt for ${this.camera.name}: ` +
            `username=${username || "<missing>"}, ` +
            `hasPassword=${passwordRaw !== undefined}, ` +
            `passwordType=${typeof passwordRaw}, ` +
            `hasNonce=${nonceRaw !== undefined}, ` +
            `hasCreated=${createdRaw !== undefined}`
        );

        if (passwordRaw && typeof passwordRaw === "object") {
            logger.debug('auth', `SOAP Password object keys for ${this.camera.name}: ${Object.keys(passwordRaw).join(", ")}`);
        }

        if (username !== this.camera.auth.username) {
            logger.debug('auth', `SOAP auth attempt for ${this.camera.name}: username=${username}, accepted=false (username mismatch)`);
            return false;
        }

        if (typeof passwordRaw === "string") {
            const accepted = passwordRaw === this.camera.auth.password;
            logger.debug('auth', `SOAP auth attempt for ${this.camera.name}: username=${username}, accepted=${accepted}, mode=PasswordText`);
            return accepted;
        }

        if (passwordRaw && typeof passwordRaw === "object") {
            const crypto = require("crypto");
            const passwordTypeUri = passwordRaw?.$attributes?.Type || passwordRaw?.Type || passwordRaw?.type || "";

            if (!passwordValue || !nonceValue || !createdValue) {
                logger.warn(`SOAP auth digest missing required fields for ${this.camera.name}`);
                return false;
            }

            let nonceBuffer;
            try {
                nonceBuffer = Buffer.from(nonceValue, "base64");
            } catch (err) {
                logger.warn(`SOAP auth digest nonce decode failed for ${this.camera.name}: ${err.message}`);
                return false;
            }

            const expectedDigest = crypto
                .createHash("sha1")
                .update(Buffer.concat([
                    nonceBuffer,
                    Buffer.from(createdValue, "utf8"),
                    Buffer.from(this.camera.auth.password, "utf8")
                ]))
                .digest("base64");

            const accepted = passwordValue === expectedDigest;

            logger.debug('auth', 
                `SOAP auth attempt for ${this.camera.name}: ` +
                `username=${username}, accepted=${accepted}, mode=PasswordDigest, type=${passwordTypeUri || "<unknown>"}`
            );

            return accepted;
        }

        logger.warn(`SOAP auth unsupported password format for ${this.camera.name}`);
        return false;
    }

    async stop() {
        try {
            await this.discoveryService.stop();
        } catch (err) {
            logger.warn(`Failed to stop WS-Discovery for ${this.camera.name}: ${err.message}`);
        }

        try {
            this.rtspProxyService.stop();
        } catch (err) {
            logger.warn(`Failed to stop RTSP proxy for ${this.camera.name}: ${err.message}`);
        }

        this.camera.lifecycle.httpReady = false;
        this.camera.lifecycle.snapshotReady = false;

        if (!this.httpServer) {
            return;
        }

        await new Promise((resolve, reject) => {
            this.httpServer.close((err) => {
                if (err) {
                    reject(err);
                    return;
                }

                logger.info(`HTTP listener stopped for ${this.camera.name} on ${this.camera.ip}:${this.camera.onvifPort}`);
                resolve();
            });
        });

        this.httpServer = null;
    }

    async start() {
        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                if (this.snapshotService.canHandleRequest(req)) {
                    await this.snapshotService.handleRequest(req, res);
                    return;
                }

                if (req.url && (req.url.startsWith("/onvif/device_service") || req.url.startsWith("/onvif/media_service"))) {
                    return;
                }

                res.statusCode = 404;
                res.end("Not Found");
            });
            this.httpServer = server;

            server.on("clientError", (err, socket) => {
                logger.error(`HTTP clientError for ${this.camera.name}: ${err.message}`);
            });
            server.prependListener("request", (req, res) => {
                logger.debug('http', `HTTP request for ${this.camera.name}: ${req.method} ${req.url} from ${req.socket.remoteAddress}`
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
                this.camera.lifecycle.httpReady = true;
                this.camera.lifecycle.snapshotReady = true;

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
                    this.lastSoapMethod = methodName;
                    logger.debug('device', `SOAP Device request received for ${this.camera.name}: ${methodName}`);
                });
                deviceSoapServer.on("error", (err) => {
                    logger.error(`SOAP Device error for ${this.camera.name}: ${err.message}`);
                });
                mediaSoapServer.on("request", (xml, methodName) => {
                    this.lastSoapMethod = methodName;
                    logger.debug('media', `SOAP Media request received for ${this.camera.name}: ${methodName}`);
                });
                mediaSoapServer.on("error", (err) => {
                    logger.error(`SOAP Media error for ${this.camera.name}: ${err.message}`);
                });

                try {
                    await this.discoveryService.start();
                } catch (err) {
                    logger.error(`Failed to start WS-Discovery for ${this.camera.name}: ${err.message}`);
                }

                try {
                    this.rtspProxyService.start();
                } catch (err) {
                    logger.error(`Failed to start RTSP proxy for ${this.camera.name}: ${err.message}`);
                }

                this.logLifecycleState();
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
