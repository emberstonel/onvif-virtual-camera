const fs = require("fs");
const yaml = require("js-yaml");
const logger = require("./log-manager");

function hasAuth(object) {
    return !!(
        object.auth &&
        object.auth.username &&
        object.auth.password
    );
}

function loadConfig(configPath) {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found at ${configPath}`);
    }

    let raw;
    try {
        raw = fs.readFileSync(configPath, "utf8");
    } catch (err) {
        throw new Error(`Failed to read config file: ${err.message}`);
    }

    let config;
    try {
        config = yaml.load(raw);
    } catch (err) {
        logger.error(`Failed to parse config file as YAML: ${err.message}`);
        throw new Error(`Failed to parse YAML: ${err.message}`);
    }

    // Validate top-level structure
    if (!config.host_sources || !Array.isArray(config.host_sources)) {
        throw new Error("Config must contain 'host_sources' as an array.");
    }

    if (!config.virtual_cameras || !Array.isArray(config.virtual_cameras)) {
        throw new Error("Config must contain 'virtual_cameras' as an array.");
    }

    // Set runtime values
    const defaultRuntime = {
        enable_debug_logs: false
    };
    const runtime = {...defaultRuntime, ...(config.runtime || {})};

    // Build host source lookup map
    const sourcesByName = {};
    for (const src of config.host_sources) {
        validateHostSource(src);

        sourcesByName[src.name] = {
            hostname: src.hostname,
            rtsp_port: src.rtsp_port,
            http_port: src.http_port,
            auth: hasAuth(src) ? {
                username: src.auth.username,
                password: src.auth.password
            } : null
        };
    }

    // Resolve virtual cameras
    const cameras = config.virtual_cameras.map((cam) => {
        validateVirtualCamera(cam);

        const source = sourcesByName[cam.host_source];
        if (!source) {
            throw new Error(
                `Virtual camera '${cam.name}' references unknown host_source '${cam.host_source}'.`
            );
        }

        // Normalize MAC
        const mac = cam.mac.toLowerCase();

        // Ensure paths start with '/'
        const rtspPath = cam.rtsp_path.startsWith("/")
            ? cam.rtsp_path
            : `/${cam.rtsp_path}`;

        const snapshotPath = cam.snapshot_path.startsWith("/")
            ? cam.snapshot_path
            : `/${cam.snapshot_path}`;

        // Construct full URLs with optional authentication
        const authPrefix = hasAuth(source)
            ? `${encodeURIComponent(source.auth.username)}:${encodeURIComponent(source.auth.password)}@`
            : "";

        // RTSP URL
        const rtspUrl =
            `rtsp://${authPrefix}${source.hostname}:${source.rtsp_port}${rtspPath}`;

        // Snapshot URL
        const snapshotUrl =
            `http://${authPrefix}${source.hostname}:${source.http_port}${snapshotPath}`;

        // Fetch stream config
        const stream = fetchStreamDetails(source, cam);

        return {
            name: cam.name,
            model: cam.model,
            mac,
            rtspUrl,
            snapshotUrl,
            stream,
            auth: hasAuth(source) ? {
                username: source.auth.username,
                password: source.auth.password
            } : null,
            host: {
                hostname: source.hostname,
                rtsp_port: source.rtsp_port,
                http_port: source.http_port
            }
        };
    });

    return { runtime, cameras };
}

function fetchStreamDetails(source, cam) {
    // Placeholder for future probing of upstream camera / RTSP stream
    // For now, return static defaults.
    return {
        encoding: "H264",
        width: 1920,
        height: 1080,
        framerate: 30,
        bitrate: 4096,
        quality: 5
    };
}

function validateHostSource(src) {
    const required = ["name", "hostname", "rtsp_port", "http_port"];
    for (const key of required) {
        if (!src[key]) {
            throw new Error(`host_source missing required field '${key}'.`);
        }
    }

    if (src.auth) {
        const hasUsername = !!src.auth.username;
        const hasPassword = !!src.auth.password;

        if (hasUsername !== hasPassword) {
            throw new Error(
                "host_source.auth must contain both username and password if either is specified."
            );
        }
    }
}

function validateVirtualCamera(cam) {
    const required = ["name", "model", "mac", "host_source", "rtsp_path", "snapshot_path"];
    for (const key of required) {
        if (!cam[key]) {
            throw new Error(`virtual_camera missing required field '${key}'.`);
        }
    }
}

module.exports = { loadConfig };