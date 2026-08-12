const splashProgressBar = document.getElementById("bundleLoadingProgressBar");
const splashProgressText = document.getElementById("bundleLoadingProgressText");
const swUpdateConfirmText = "The game has been updated. Would you like to reload?";
const onSWRegisterError = function (e) {
  console.error("sw register error:", e);
  window.installBundle = undefined;
  bootGame();
};
const onSWInstallError = function () {
  console.error("sw install error");
  window.installBundle = undefined;
  bootGame();
};
var hasBoot = false;
const bootGame = function () {
  if (hasBoot) {
    return;
  }
  hasBoot = true;
  console.log("boot");
  for (const n of writeJS) {
    var e = document.createElement("script");
    e.type = "text/javascript";
    e.src = n;
    if (n.indexOf("system.bundle") > 0) {
      e.onload = function () {
        var e = document.createElement("script");
        e.innerText = writeImport;
        document.body.appendChild(e);
      };
    }
    document.body.appendChild(e);
  }
  var t = document.createElement("script");
  t.type = "systemjs-importmap";
  t.src = writeJSON;
  document.body.appendChild(t);
};
const sw_start = function () {
  if (splashProgressBar) {
    splashProgressBar.style.width = "0%";
  }
  const n = function (e, t) {
    var n = (100 * e) / t;
    const percentText = n.toFixed(0) + "%";
    if (splashProgressBar) {
      splashProgressBar.style.width = n.toFixed(2) + "%";
    }
    if (splashProgressText) {
      splashProgressText.textContent = "Loading " + percentText;
    }
  };
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    window.deferredPromp = e;
  });
  if (navigator.serviceWorker) {
    const s = {};
    const l = function () {
      var e = 0;
      for (var t in s) {
        if (initBundles.indexOf(t) >= 0) {
          e += s[t];
        }
      }
      n(e, initBundles.length);
      if (e == initBundles.length) {
        bootGame();
      }
    };
    function o(e) {
      console.log("sw activated", e);
      window.installBundle = function (e) {
        navigator.serviceWorker.controller.postMessage({
          what: "installBundle",
          bundle: e,
          version: allBundles[e],
        });
      };
      window.cleanBundle = function (e) {
        navigator.serviceWorker.controller.postMessage({
          what: "cleanBundle",
          bundle: e,
          version: allBundles[e],
        });
      };
      window.cleanAllBundles = function () {
        navigator.serviceWorker.controller.postMessage({
          what: "cleanAllBundle",
        });
      };
      for (const t of initBundles) {
        window.installBundle(t);
      }
      l();
      navigator.serviceWorker.controller.postMessage({
        what: "cleanBundles",
        bundles: allBundles,
      });
    }
    function r() {
      const e = swUpdateConfirmText ? confirm(swUpdateConfirmText) : true;
      if (e) {
        navigator.serviceWorker
          .getRegistration()
          .then((e) => {
            e.waiting.postMessage({ what: "skipWaiting" });
          })
          .catch((e) => {
            window.location.reload();
          });
        return true;
      } else {
        return false;
      }
    }
    var a = false;
    navigator.serviceWorker
      .register(swPath)
      .then(function (e) {
        navigator.serviceWorker.onmessage = function (e) {
          if (e.data.what === "installProgress") {
            s[e.data.bundle] = e.data.percent;
            if (e.data.percent === 1) {
              window.localStorage.removeItem(e.data.bundle);
              window.localStorage.setItem(
                e.data.bundle,
                allBundles[e.data.bundle],
              );
              window.cleanBundle(e.data.bundle);
            }
            if (window.onBundleInstallProgress) {
              window.onBundleInstallProgress(e.data.bundle, e.data.percent);
            }
            if (initBundles.indexOf(e.data.bundle) >= 0) {
              l();
            }
          } else if (e.data.what === "installError") {
            window.localStorage.removeItem(e.data.bundle);
            if (window.onBundleInstallError) {
              window.onBundleInstallError(e.data.bundle, e.data.error);
            }
          } else if (e.data.what === "onCleanBundle") {
            window.localStorage.removeItem(e.data.bundle);
          } else if (e.data.what === "cleanFinish") {
            if (window.onBundlesCleanFinish) {
              window.onBundlesCleanFinish();
            }
          }
        };
        navigator.serviceWorker.oncontrollerchange = function () {
          console.log("controllerchange");
          if (a) {
            return;
          }
          a = true;
          console.log("reload...");
          window.location.reload();
        };
        if (e.waiting) {
          if (r()) {
            return;
          }
        }
        e.onupdatefound = function () {
          const t = e.installing;
          console.log("onupdatefound", t.state);
          t.onstatechange = function (e) {
            console.log("installingWorker statechange", e.target.state);
            switch (t.state) {
              case "installed":
                if (navigator.serviceWorker.controller) {
                  r();
                }
                break;
              case "redundant":
                onSWInstallError();
                break;
            }
          };
        };
        var t = navigator.serviceWorker.controller;
        if (t) {
          console.log("controller state", t.state);
          o("activated controller");
          t.onstatechange = function (e) {
            console.log("controller statechange", e.target.state);
          };
        } else {
          var n;
          if (e.installing) {
            n = e.installing;
          } else if (e.waiting) {
            n = e.waiting;
          } else if (e.active) {
            n = e.active;
          }
          if (n) {
            console.log("serviceWorker", n.state);
            if (n.state === "activated") {
              o("activated serviceWorker exsits");
            } else {
              n.onstatechange = function (e) {
                console.log("serviceWorker statechange to", e.target.state);
                if (e.target.state === "activated") {
                  o("serviceWorker activated");
                }
              };
            }
          }
        }
      })
      .catch(function (e) {
        onSWRegisterError(e);
      });
  } 
  else {
    window.installBundle = undefined;
    bootGame();
  }
};
sw_start();
