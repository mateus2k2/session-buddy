"use strict";

const params = new URLSearchParams(location.search);
const url   = params.get("url")   || "";
const title = params.get("title") || "";

if (title) document.title = title;
document.getElementById("url-display").textContent = url;

document.getElementById("btn-open").addEventListener("click", async () => {
  if (!url) return;
  // browser.tabs.create works for file:// URLs; browser.tabs.update does not.
  try {
    await browser.tabs.create({ url });
  } catch (e) {
    document.getElementById("status").textContent = "Could not open: " + e.message;
  }
});

document.getElementById("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(url);
    document.getElementById("status").textContent = "URL copied to clipboard";
    setTimeout(() => { document.getElementById("status").textContent = ""; }, 2000);
  } catch {
    document.getElementById("status").textContent = "Copy failed — select and copy the URL above manually";
  }
});
