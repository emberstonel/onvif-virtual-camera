const TcpProxy = require("node-tcp-proxy");
const logger = require("../log-manager");

class RtspProxyService {
    constructor(camera, onFatalError) {
        this.camera = camera;
        this.onFatalError = onFatalError;
        this.proxy = null;
    }

    start() {
        if (this.proxy) {
            return;
        }

        logger.info(
            `Starting RTSP TCP proxy for ${this.camera.name}: ` +
            `${this.camera.ip}:${this.camera.rtspProxyPort} -> ` +
            `${this.camera.source.hostname}:${this.camera.source.rtspPort}`
        );

        this.proxy = TcpProxy.createProxy(
            this.camera.rtspProxyPort,
            this.camera.source.hostname,
            this.camera.source.rtspPort,
            {
                hostname: this.camera.ip,
                localAddress: this.camera.ip,
                quiet: true
            }
        );

        this.proxy.server?.on("error", (err) => {
            this.onFatalError?.(err);
        });

        this.camera.lifecycle.rtspProxyReady = true;
    }

    stop() {
        if (!this.proxy) {
            return;
        }

        this.proxy.end();
        this.proxy = null;
        this.camera.lifecycle.rtspProxyReady = false;
    }
}

module.exports = RtspProxyService;
