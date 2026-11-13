// Reload the page; a YouTube watch page keeps its position.
export function reloadPage(time) {
  if (/^(www|m)\.youtube\.com$/.test(location.hostname) && location.pathname === "/watch" && time >= 1) {
    const url = new URL(location.href);
    url.searchParams.set("t", `${Math.floor(time)}s`);
    location.replace(url.href);
  } else {
    location.reload();
  }
}
