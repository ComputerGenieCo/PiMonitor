/**
 * Copyright (C) 2025 ComputerGenieCo
 */

const express = require('express');
const { NodeSSH } = require('node-ssh');
const Evilscan = require('evilscan');
const path = require('path');

// Server configuration
const port = 3000;
const serverIp = 'localhost';

// Application configuration
const defaultZip = '90210';
const sshConfig = {
    username: 'orangepi',
    password: 'orangepi',
    timeout: 5000
};
const refreshInterval = 300000; // 5 minutes in milliseconds

// Network configuration
const networkConfig = {
    baseIP: '192.168.3.0',
    netmask: '255.255.255.0',
    scanRange: {
        start: '192.168.3.1',
        end: '192.168.3.254'
    }
};

// Storage
const devices = new Map();
const weatherCache = {
    temp: null,
    lastUpdate: null
};

// Express app setup
const app = express();
app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Function to validate IP is within network range
function isIPInNetwork(ip, baseIP, netmask) {
    const ipParts = ip.split('.').map(Number);
    const networkParts = baseIP.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);

    return ipParts.every((part, i) =>
        (part & maskParts[i]) === (networkParts[i] & maskParts[i])
    );
}

// Scan network for Orange Pi devices
async function scanNetwork() {
    return new Promise((resolve, reject) => {
        const options = {
            target: `${networkConfig.scanRange.start}-${networkConfig.scanRange.end}`,
            port: '22',
            status: 'TROU',
            banner: true
        };

        console.log(`Scanning range: ${networkConfig.scanRange.start} to ${networkConfig.scanRange.end}`);

        const scanner = new Evilscan(options);

        scanner.on('result', async (data) => {
            if (data.status === 'open') {
                try {
                    const ssh = new NodeSSH();
                    await ssh.connect({
                        host: data.ip,
                        ...sshConfig
                    });

                    // Copy the script if it doesn't exist
                    await ssh.putFile('scripts/get_device_stats.sh', '/tmp/get_device_stats.sh');
                    await ssh.execCommand('chmod +x /tmp/get_device_stats.sh');

                    // Run the script
                    const result = await ssh.execCommand('/tmp/get_device_stats.sh');
                    if (result.stdout) {
                        const [temp, uptime] = result.stdout.split(' ').map(Number);
                        devices.set(data.ip, {
                            ip: data.ip,
                            temp: temp / 1000,
                            uptime: uptime,
                            lastUpdate: new Date()
                        });
                    }
                    ssh.dispose();
                } catch (error) {
                    console.log(`Failed to connect to ${data.ip}: ${error.message}`);
                }
            }
        });

        scanner.on('error', (err) => {
            console.error('Scanner error:', err);
        });

        scanner.on('done', () => {
            resolve();
        });

        scanner.run();
    });
}

// Weather data fetching function
async function getWeatherData() {
    try {
        // Get coordinates from ZIP using Nominatim
        const geocodeResponse = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${defaultZip}&country=USA&format=json`, {
            headers: {
                'User-Agent': 'PiMonitor/1.0'  // Required by Nominatim ToS
            }
        });
        const geocodeData = await geocodeResponse.json();

        if (!Array.isArray(geocodeData) || geocodeData.length === 0) {
            console.error('Geocoding failed: Empty response for ZIP', defaultZip);
            throw new Error('Invalid geocoding response');
        }

        const lat = geocodeData[0].lat;
        const long = geocodeData[0].lon;

        console.log(`Geocoded ${defaultZip} to: ${lat},${long}`);

        // Rest of weather fetching
        const pointsResponse = await fetch(`https://api.weather.gov/points/${lat},${long}`);
        const pointsData = await pointsResponse.json();

        if (!pointsData.properties || !pointsData.properties.forecastHourly) {
            throw new Error('Invalid points response from NWS API');
        }

        // Then get current conditions using the hourly forecast endpoint
        const weatherResponse = await fetch(pointsData.properties.forecastHourly);
        const weatherData = await weatherResponse.json();

        if (!weatherData.properties || !weatherData.properties.periods || !weatherData.properties.periods[0]) {
            throw new Error('Invalid weather response from NWS API');
        }

        // Update cache properties instead of reassigning
        weatherCache.temp = weatherData.properties.periods[0].temperature;
        weatherCache.lastUpdate = new Date();

        return weatherCache;
    } catch (error) {
        console.error('Weather fetch failed:', error.message);
        return weatherCache || { temp: null, lastUpdate: null };
    }
}

// API endpoint for temperature data
app.get('/api/temperatures', (req, res) => {
    res.json(Array.from(devices.values()));
});

// Add weather API endpoint
app.get('/api/weather', async (req, res) => {
    // Update weather every 30 minutes
    if (!weatherCache.lastUpdate ||
        (new Date() - weatherCache.lastUpdate) > 30 * 60 * 1000) {
        await getWeatherData();
    }
    res.json(weatherCache);
});

// Add config endpoint
app.get('/api/config', (req, res) => {
    res.json({ refreshInterval });
});

// Update the scan interval handler to handle promises
setInterval(() => {
    scanNetwork().catch(err => {
        console.error('Scan failed:', err);
    });
}, refreshInterval);

// Initial scan
scanNetwork().catch(err => {
    console.error('Initial scan failed:', err);
});

app.listen(port, serverIp, () => {
    console.log(`Server running at http://${serverIp}:${port}`);
});
