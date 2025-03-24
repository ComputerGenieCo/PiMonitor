#!/bin/bash

# Copyright (C) 2025 ComputerGenieCo
# This script is part of PiMonitor, licensed under GNU GPL v3.

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

# Print only the number
echo $avg_temp
