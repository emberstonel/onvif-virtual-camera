const fs = require("fs");
const path = require("path");
const logger = require("./src/log-manager");
const configLoader = require("./src/config-loader");
const CameraManager = require("./src/camera-manager");

async function start() {
    
    // Begin logging and error tracking
    let startupError = false;
    logger.info("Starting ONVIF Virtual Camera Proxy...");

    // Load config.yaml from local path (for debug) or the mounted root path
    const configPath = fs.existsSync(path.resolve("./config.yml")) ? path.resolve("./config.yml") : "/config.yml";

    let config;
    try {
        config = configLoader.loadConfig(configPath);
        logger.info(`Loaded configuration for ${config.cameras.length} virtual cameras`);
    } catch (err) {
        logger.error(`Failed to load config: ${err.message}`);
        process.exit(1);
    }

    // Start one ONVIF server per virtual camera
    for (const cam of config.cameras) {
        try {
            const manager = new CameraManager(cam);
            const summary = await manager.start();
            logger.info(
                `Camera startup summary for ${summary.name}: ` +
                `interface=${summary.interface}, ip=${summary.ip}, ` +
                `rtsp=${summary.rtspUri}, snapshot=${summary.snapshotUri}`
            );
        } catch (err) {
            startupError = true;
            logger.error(`Failed to initialize camera ${cam.name}: ${err.message}`);
        }
    }
    if (!startupError) {
        logger.info("Initialization complete. ONVIF servers running.");
    }
}

start();
