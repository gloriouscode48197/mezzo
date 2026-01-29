# Voice Compass

A behavioral calibration tool that helps you learn appropriate speaking volume in shared spaces.

## About

Voice Compass uses the Horizon Band metaphor to help you understand and maintain comfortable speaking volumes. Rather than showing numbers or precise measurements, it provides gentle, contextual feedback that builds intuition over time.

**Design principles:**
- Favor trust over precision
- Favor less UI over more UI
- Tool builds intuition, then gets out of the way
- Gentle, contextual, optional feedback

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the `voice-compass` folder
5. Click the Voice Compass icon in your browser toolbar

## Usage

1. **Select a context** - Choose the environment you're in (Focused Office, Open Office, Home, On Call)
2. **Calibrate** - Follow the three-step calibration:
   - Stay quiet for 5 seconds (noise floor measurement)
   - Speak at your normal comfortable volume
   - Speak at a "nearby-audible" level
3. **Monitor** - Start monitoring and the Horizon Band will show where your voice sits

As you maintain appropriate volume, your confidence score increases and the UI becomes less prominent. Quick self-corrections are rewarded. The tool learns with you.

## Privacy

**Nothing is recorded or stored.**

- Audio is processed entirely in your browser
- No audio data leaves your device
- No recordings are saved
- Only calibration settings are stored locally
- Microphone is only accessed during calibration or active monitoring
