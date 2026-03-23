const logger = require("../log-manager");

class MediaService {
    constructor({ rtspUrl, snapshotUrl }) {
        this.rtspUrl = rtspUrl;
        this.snapshotUrl = snapshotUrl;

        // Protect expects exactly one profile with predictable tokens
        this.profileToken = "profile_1";
        this.videoSourceToken = "video_source_1";
        this.videoEncoderToken = "video_encoder_1";
    }

    // ONVIF: GetProfiles
    async GetProfiles() {
        return {
            Profiles: [
                {
                    $: {
                        token: this.profileToken,
                        fixed: "true"
                    },
                    Name: "VirtualProfile",
                    VideoSourceConfiguration: {
                        SourceToken: this.videoSourceToken
                    },
                    VideoEncoderConfiguration: {
                        Encoding: "H264",
                        Resolution: { Width: 1920, Height: 1080 },
                        Quality: 5,
                        RateControl: {
                            FrameRateLimit: 30,
                            EncodingInterval: 1,
                            BitrateLimit: 4096
                        }
                    }
                }
            ]
        };
    }

    // ONVIF: GetStreamUri
    async GetStreamUri() {
        return {
            MediaUri: {
                Uri: this.rtspUrl,
                InvalidAfterConnect: false,
                InvalidAfterReboot: false,
                Timeout: "PT60S"
            }
        };
    }

    // ONVIF: GetSnapshotUri
    async GetSnapshotUri() {
        return {
            MediaUri: {
                Uri: this.snapshotUrl,
                InvalidAfterConnect: false,
                InvalidAfterReboot: false,
                Timeout: "PT60S"
            }
        };
    }

    // ONVIF: GetVideoSources
    async GetVideoSources() {
        return {
            VideoSources: [
                {
                    $: { token: this.videoSourceToken },
                    Framerate: 30,
                    Resolution: { Width: 1920, Height: 1080 }
                }
            ]
        };
    }

    // ONVIF: GetVideoSourceConfiguration
    async GetVideoSourceConfiguration() {
        return {
            VideoSourceConfiguration: {
                $: { token: this.videoSourceToken },
                Name: "VideoSourceConfig",
                UseCount: 1,
                SourceToken: this.videoSourceToken
            }
        };
    }
}

module.exports = MediaService;
