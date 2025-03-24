#!/bin/bash

# Copyright (C) 2025 ComputerGenieCo
# This script is part of PiMonitor, licensed under GNU GPL v3.
#
# Collects and returns device statistics including:
# - Average CPU temperature across all thermal zones
# - System uptime in seconds

# Get the number of thermal zones (cores)
num_zones=$(ls -l /sys/class/thermal/th* | grep zone | wc -l)

# Initialize sum of temperatures
sum_temp=0

# Read temperature from each thermal zone and add to sum
for ((i=0; i<num_zones; i++)); do
  temp=$(cat /sys/class/thermal/thermal_zone$i/temp)
  sum_temp=$((sum_temp + temp))
done

# Calculate average temperature
avg_temp=$((sum_temp / num_zones))

# Get system uptime in seconds
uptime_sec=$(cat /proc/uptime | awk '{print int($1)}')

# Print temperature and uptime
echo "$avg_temp $uptime_sec"