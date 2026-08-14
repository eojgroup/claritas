#!/usr/bin/env node

// MapKit draws a GeoJSON ring literally in projected map space. Natural Earth
// rings that jump directly between +180 and -180 therefore need to be split at
// the antimeridian before they are bundled with the app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const resourcePath = path.join(directory, "Claritas", "Resources", "WorldCountries.geojson");
const collection = JSON.parse(fs.readFileSync(resourcePath, "utf8"));

function samePoint(left, right) {
  return Math.abs(left[0] - right[0]) < 1e-9 && Math.abs(left[1] - right[1]) < 1e-9;
}

function unwrapRing(ring) {
  const result = [ring[0].slice(0, 2)];
  for (const coordinate of ring.slice(1)) {
    let longitude = coordinate[0];
    const previous = result[result.length - 1][0];
    while (longitude - previous > 180) longitude -= 360;
    while (longitude - previous < -180) longitude += 360;
    result.push([longitude, coordinate[1]]);
  }
  return result;
}

function clipAtLongitude(points, boundary, keepGreater) {
  const output = [];
  const inside = (point) => keepGreater ? point[0] >= boundary : point[0] <= boundary;
  const intersection = (start, end) => {
    const delta = end[0] - start[0];
    if (Math.abs(delta) < 1e-12) return [boundary, end[1]];
    const ratio = (boundary - start[0]) / delta;
    return [boundary, start[1] + (end[1] - start[1]) * ratio];
  };

  let start = points[points.length - 1];
  for (const end of points) {
    const startInside = inside(start);
    const endInside = inside(end);
    if (endInside) {
      if (!startInside) output.push(intersection(start, end));
      output.push(end);
    } else if (startInside) {
      output.push(intersection(start, end));
    }
    start = end;
  }
  return output;
}

function normalizedRing(points) {
  const deduplicated = [];
  for (const point of points) {
    if (!deduplicated.length || !samePoint(point, deduplicated[deduplicated.length - 1])) {
      deduplicated.push(point);
    }
  }
  if (deduplicated.length < 3) return null;
  if (!samePoint(deduplicated[0], deduplicated[deduplicated.length - 1])) {
    deduplicated.push([...deduplicated[0]]);
  }
  if (deduplicated.length < 4) return null;
  const twiceArea = deduplicated.slice(0, -1).reduce((area, point, index) => {
    const next = deduplicated[index + 1];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return Math.abs(twiceArea) > 1e-8 ? deduplicated : null;
}

function splitOuterRingAtAntimeridian(ring) {
  const hasJump = ring.slice(1).some((point, index) => Math.abs(point[0] - ring[index][0]) > 180);
  if (!hasJump) return [ring];

  const unwrapped = unwrapRing(ring);
  const pieces = [];
  for (const shift of [-360, 0, 360]) {
    const shifted = unwrapped.map(([longitude, latitude]) => [longitude + shift, latitude]);
    const westClipped = clipAtLongitude(shifted, -180, true);
    const worldClipped = clipAtLongitude(westClipped, 180, false);
    const normalized = normalizedRing(worldClipped);
    if (normalized) pieces.push(normalized);
  }
  return pieces;
}

for (const feature of collection.features ?? []) {
  const geometry = feature.geometry;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) continue;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const sanitized = [];
  for (const polygon of polygons) {
    const outer = polygon[0] ?? [];
    const hasJump = outer.slice(1).some((point, index) => Math.abs(point[0] - outer[index][0]) > 180);
    if (!hasJump) {
      sanitized.push(polygon);
      continue;
    }
    if (polygon.length !== 1) {
      throw new Error(`Cannot safely split a dateline polygon with holes (${feature.properties?.iso2 ?? "unknown"}).`);
    }
    for (const piece of splitOuterRingAtAntimeridian(outer)) sanitized.push([piece]);
  }
  feature.geometry = sanitized.length === 1
    ? { type: "Polygon", coordinates: sanitized[0] }
    : { type: "MultiPolygon", coordinates: sanitized };
}

fs.writeFileSync(resourcePath, `${JSON.stringify(collection)}\n`);
