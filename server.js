/**
 * Copyright (C) 2025 ComputerGenieCo
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const express = require('express');
const { NodeSSH } = require('node-ssh');
const Evilscan = require('evilscan');
const path = require('path');

const app = express();
const port = 3000;
const serverIp = '192.168.1.20';
const defaultZip = '90210';

// Add weather data cache
let weatherCache = {
    temp: null,
    lastUpdate: null
};

// Add CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve static files
app.use(express.static('public'));

// Store discovered devices
let devices = new Map();

// Scan network for Orange Pi devices
async function scanNetwork() {
    return new Promise((resolve, reject) => {
        const options = {
            target: '192.168.1.21-192.168.3.254',
            port: '22',
            status: 'TROU', // timeout, refused, open, unreachable
            banner: true
        };

        const scanner = new Evilscan(options);

        scanner.on('result', async (data) => {
            if (data.status === 'open') {
                try {
                    const ssh = new NodeSSH();
                    await ssh.connect({
                        host: data.ip,
                        username: 'orangepi',
                        password: 'orangepi',
                        timeout: 5000
                    });

                    // Copy the script if it doesn't exist
                    await ssh.putFile('scripts/get_avg_temp.sh', '/tmp/get_avg_temp.sh');
                    await ssh.execCommand('chmod +x /tmp/get_avg_temp.sh');

                    // Run the script
                    const result = await ssh.execCommand('/tmp/get_avg_temp.sh');
                    if (result.stdout) {
                        devices.set(data.ip, {
                            ip: data.ip,
                            temp: parseInt(result.stdout) / 1000,
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

        weatherCache = {
            temp: weatherData.properties.periods[0].temperature,
            lastUpdate: new Date()
        };

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

// Update the scan interval handler to handle promises
setInterval(() => {
    scanNetwork().catch(err => {
        console.error('Scan failed:', err);
    });
}, 30000);

// Initial scan
scanNetwork().catch(err => {
    console.error('Initial scan failed:', err);
});

app.listen(port, serverIp, () => {
    console.log(`Server running at http://${serverIp}:${port}`);
});
