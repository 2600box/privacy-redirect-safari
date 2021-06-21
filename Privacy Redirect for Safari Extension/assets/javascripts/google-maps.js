"use strict";

const mapsInstances = ["https://openstreetmap.org"];
const mapCentreRegex = /@(-?\d[0-9.]*),(-?\d[0-9.]*),(\d{1,2})[.z]/;
const dataLatLngRegex = /(!3d|!4d)(-?[0-9]{1,10}.[0-9]{1,10})/g;
const placeRegex = /\/place\/(.*)\//;
const travelModes = {
  driving: "fossgis_osrm_car",
  walking: "fossgis_osrm_foot",
  bicycling: "fossgis_osrm_bike",
  transit: "fossgis_osrm_car", // not implemented on OSM, default to car.
};
const layers = {
  none: "S",
  transit: "T",
  traffic: "S", // not implemented on OSM, default to standard.
  bicycling: "C",
};
let disableOsm;
let osmInstance;
let exceptions;

window.browser = window.browser || window.chrome;

function addressToLatLng(address, callback) {
  const xmlhttp = new XMLHttpRequest();
  xmlhttp.onreadystatechange = () => {
    if (xmlhttp.readyState === XMLHttpRequest.DONE) {
      if (xmlhttp.status === 200) {
        const json = JSON.parse(xmlhttp.responseText)[0];
        if (json) {
          callback(
            `${json.lat}%2C${json.lon}`,
            `${json.boundingbox[2]},${json.boundingbox[1]},${json.boundingbox[3]},${json.boundingbox[0]}`
          );
        }
      } else {
        console.info("Error: Status is " + xmlhttp.status);
      }
    }
  };
  xmlhttp.open(
    "GET",
    `https://nominatim.openstreetmap.org/search/${address}?format=json&limit=1`,
    false
  );
  xmlhttp.send();
}

function getRandomInstance() {
  return mapsInstances[~~(mapsInstances.length * Math.random())];
}

function isNotException(url) {
  return !exceptions.some((regex) => regex.test(url.href));
}

function shouldRedirect(url) {
  return (
    isNotException(url) &&
    !disableOsm
  );
}

function redirectGoogleMaps(url) {
  let redirect;
  let mapCentre = "";
  let params = "";
  // Set map centre if present
  if (url.pathname.match(mapCentreRegex)) {
    const [, lat, lon, zoom] = url.pathname.match(mapCentreRegex);
    mapCentre = `#map=${zoom}/${lat}/${lon}`;
  } else if (url.search.includes("center=")) {
    const [lat, lon] = url.searchParams.get("center").split(",");
    mapCentre = `#map=${url.searchParams.get("zoom") || "17"}/${lat}/${lon}`;
    // Set default zoom if mapCentre not present
  } else {
    params = "&zoom=17";
  }
  // Set map layer
  params = `${params}&layers=${
    layers[url.searchParams.get("layer")] || layers["none"]
  }`;
  // Handle Google Maps Embed API
  if (url.pathname.split("/").includes("embed")) {
    let query = "";
    if (url.searchParams.has("q")) {
      query = url.searchParams.get("q");
    } else if (url.searchParams.has("query")) {
      query = url.searchParams.has("query");
    } else if (url.searchParams.has("pb")) {
      try {
        query = url.searchParams.get("pb").split(/!2s(.*?)!/)[1];
      } catch (error) {
        console.error(error);
        // Unable to find map marker in URL.
      }
    }
    let marker, bbox;
    mapsHelper.addressToLatLng(query, (coords, boundingbox) => {
      marker = coords;
      bbox = boundingbox;
    });
    redirect = `${osmInstance}/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
    // Handle Google Maps Directions
  } else if (url.pathname.split("/").includes("dir")) {
    const travelMode =
      travelModes[url.searchParams.get("travelmode")] || travelModes["driving"];
    let origin;
    mapsHelper.addressToLatLng(url.searchParams.get("origin"), (coords) => {
      origin = coords;
    });
    let destination;
    mapsHelper.addressToLatLng(
      url.searchParams.get("destination"),
      (coords) => {
        destination = coords;
      }
    );
    redirect = `${osmInstance}/directions?engine=${travelMode}&route=${origin}%3B${destination}${mapCentre}${params}`;
    // Get marker from data attribute
  } else if (
    url.pathname.includes("data=") &&
    url.pathname.match(dataLatLngRegex)
  ) {
    const [mlat, mlon] = url.pathname.match(dataLatLngRegex);
    redirect = `${osmInstance}/?mlat=${mlat.replace(
      "!3d",
      ""
    )}&mlon=${mlon.replace("!4d", "")}${mapCentre}${params}`;
    // Get marker from ll param
  } else if (url.searchParams.has("ll")) {
    const [mlat, mlon] = url.searchParams.get("ll").split(",");
    redirect = `${osmInstance}/?mlat=${mlat}&mlon=${mlon}${mapCentre}${params}`;
    // Get marker from viewpoint param.
  } else if (url.searchParams.has("viewpoint")) {
    const [mlat, mlon] = url.searchParams.get("viewpoint").split(",");
    redirect = `${osmInstance}/?mlat=${mlat}&mlon=${mlon}${mapCentre}${params}`;
    // Use query as search if present.
  } else {
    let query;
    if (url.searchParams.has("q")) {
      query = url.searchParams.get("q");
    } else if (url.searchParams.has("query")) {
      query = url.searchParams.get("query");
    } else if (url.pathname.match(placeRegex)) {
      query = url.pathname.match(placeRegex)[1];
    }
    redirect = `${osmInstance}/${query ? "search?query=" + query : ""}${
      mapCentre || "#"
    }${params}`;
  }

  return redirect;
}

browser.storage.sync.get(
  [
    "disableOsm",
    "simplyTranslateInstance",
    "exceptions",
  ],
  (result) => {
    disableOsm = result.disableOsm;
    osmInstance = result.osmInstance || getRandomInstance();
    exceptions = result.exceptions
      ? result.exceptions.map((e) => {
          return new RegExp(e);
        })
      : [];
    const url = new URL(window.location);
    if (shouldRedirect(url)) {
      const redirect = redirectGoogleMaps(url);
      console.info("Redirecting", `"${url.href}"`, "=>", `"${redirect}"`);
      window.location = redirect;
    }
  }
);
