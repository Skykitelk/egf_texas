/**
 * Runtime UI：Update Now 模态 + initBundles 预装进度
 */
(function (global) {
    const MODAL_ID = 'bz-runtime-update-modal';
    const OVERLAY_ID = 'bz-runtime-update-overlay';
    const INIT_LOADING_ID = 'bz-init-bundles-loading';

    function ensureOverlayDom() {
        if (global.document.getElementById(OVERLAY_ID)) {
            ensureRetryButton();
            return;
        }
        const overlay = global.document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'bz-hidden';
        overlay.innerHTML =
            '<div class="bz-spinner" aria-label="Updating"></div>' +
            '<p class="bz-update-status">Updating...</p>' +
            '<div class="bz-update-progress"><span style="width:0%"></span></div>' +
            '<button type="button" id="bz-update-retry" class="bz-hidden">Retry</button>';
        global.document.body.appendChild(overlay);
    }

    function ensureDom() {
        if (!global.document.getElementById(MODAL_ID)) {
            const wrap = global.document.createElement('div');
            wrap.innerHTML =
                '<div id="' +
                MODAL_ID +
                '" class="bz-hidden" role="dialog" aria-modal="true">' +
                '<div class="bz-modal-panel">' +
                '<p class="bz-modal-message">A new version is available. Please update to continue.</p>' +
                '<div class="bz-modal-actions">' +
                '<button type="button" id="bz-update-now">OK</button>' +
                '</div></div></div>';
            while (wrap.firstChild) {
                global.document.body.appendChild(wrap.firstChild);
            }
        }
        ensureOverlayDom();
        ensureInitLoadingDom();
    }

    function ensureInitLoadingDom() {
        if (global.document.getElementById(INIT_LOADING_ID)) {
            return;
        }
        const el = global.document.createElement('div');
        el.id = INIT_LOADING_ID;
        el.className = 'bz-hidden';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML =
            '<div class="bz-spinner" aria-hidden="true"></div>' +
            '<p class="bz-init-status">Loading resources...</p>' +
            '<div class="bz-init-progress"><span style="width:0%"></span></div>' +
            '<p class="bz-init-detail"></p>';
        global.document.body.appendChild(el);
    }

    function ensureRetryButton() {
        const overlay = getOverlay();
        if (!overlay || global.document.getElementById('bz-update-retry')) {
            return;
        }
        const retryBtn = global.document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.id = 'bz-update-retry';
        retryBtn.className = 'bz-hidden';
        retryBtn.textContent = 'Retry';
        overlay.appendChild(retryBtn);
    }

    function getModal() {
        return global.document.getElementById(MODAL_ID);
    }

    function getOverlay() {
        return global.document.getElementById(OVERLAY_ID);
    }

    function getInitLoading() {
        ensureInitLoadingDom();
        return global.document.getElementById(INIT_LOADING_ID);
    }

    function showRuntimeUpdateModal() {
        ensureDom();
        return new Promise(function (resolve) {
            const modal = getModal();
            const nowBtn = global.document.getElementById('bz-update-now');
            if (!modal || !nowBtn) {
                resolve();
                return;
            }

            function cleanup() {
                modal.classList.add('bz-hidden');
                nowBtn.removeEventListener('click', onAgree);
            }

            function onAgree() {
                cleanup();
                resolve();
            }

            // OK-only; no cancel / later
            nowBtn.addEventListener('click', onAgree);
            modal.classList.remove('bz-hidden');
        });
    }

    function resetRuntimeUpdateOverlay() {
        ensureDom();
        const overlay = getOverlay();
        if (!overlay) {
            return;
        }
        overlay.classList.remove('bz-update-failed');
        const spinner = overlay.querySelector('.bz-spinner');
        const progress = overlay.querySelector('.bz-update-progress');
        const retryBtn = global.document.getElementById('bz-update-retry');
        if (spinner) {
            spinner.classList.remove('bz-hidden');
        }
        if (progress) {
            progress.classList.remove('bz-hidden');
        }
        if (retryBtn) {
            retryBtn.classList.add('bz-hidden');
        }
        setRuntimeUpdateProgress(0);
        setRuntimeUpdateStatus('Updating...');
    }

    function showRuntimeUpdateOverlay() {
        ensureDom();
        const overlay = getOverlay();
        if (overlay) {
            overlay.classList.remove('bz-hidden');
            resetRuntimeUpdateOverlay();
        }
    }

    function hideRuntimeUpdateOverlay() {
        const overlay = getOverlay();
        if (overlay) {
            overlay.classList.add('bz-hidden');
        }
    }

    function setRuntimeUpdateProgress(percent) {
        const overlay = getOverlay();
        if (!overlay) {
            return;
        }
        const bar = overlay.querySelector('.bz-update-progress span');
        if (bar) {
            const value = Math.max(0, Math.min(100, percent));
            bar.style.width = value.toFixed(1) + '%';
        }
    }

    function setRuntimeUpdateStatus(text) {
        const overlay = getOverlay();
        if (!overlay) {
            return;
        }
        const status = overlay.querySelector('.bz-update-status');
        if (status) {
            status.textContent = text || 'Updating...';
        }
    }

    function showRuntimeUpdateError(message) {
        ensureDom();
        return new Promise(function (resolve, reject) {
            const overlay = getOverlay();
            const retryBtn = global.document.getElementById('bz-update-retry');
            if (!overlay || !retryBtn) {
                reject(new Error('update retry UI unavailable'));
                return;
            }

            overlay.classList.add('bz-update-failed');
            const spinner = overlay.querySelector('.bz-spinner');
            const progress = overlay.querySelector('.bz-update-progress');
            if (spinner) {
                spinner.classList.add('bz-hidden');
            }
            if (progress) {
                progress.classList.add('bz-hidden');
            }
            setRuntimeUpdateStatus(message || 'Update failed. Please try again.');
            retryBtn.classList.remove('bz-hidden');

            function onRetry() {
                retryBtn.removeEventListener('click', onRetry);
                resolve();
            }

            retryBtn.addEventListener('click', onRetry);
        });
    }

    function showInitBundlesLoading() {
        ensureDom();
        const el = getInitLoading();
        if (el) {
            el.classList.remove('bz-hidden');
            setInitBundlesProgress(0, 'Loading resources...', '');
        }
    }

    function hideInitBundlesLoading() {
        const el = global.document.getElementById(INIT_LOADING_ID);
        if (el) {
            el.classList.add('bz-hidden');
        }
    }

    function setInitBundlesProgress(percent, statusText, detailText) {
        const el = getInitLoading();
        if (!el) {
            return;
        }
        const value = Math.max(0, Math.min(100, Number(percent) || 0));
        const bar = el.querySelector('.bz-init-progress span');
        if (bar) {
            bar.style.width = value.toFixed(1) + '%';
        }
        const status = el.querySelector('.bz-init-status');
        if (status && statusText != null) {
            status.textContent = statusText;
        }
        const detail = el.querySelector('.bz-init-detail');
        if (detail && detailText != null) {
            detail.textContent = detailText;
        }
    }

    function api() {
        if (!global.WebBundleZipper) {
            global.WebBundleZipper = {};
        }
        return global.WebBundleZipper;
    }

    function closeInitBundlesLoading() {
        hideInitBundlesLoading();
    }

    const root = api();
    root.UI = {
        ensureDom: ensureDom,
        showRuntimeUpdateModal: showRuntimeUpdateModal,
        showRuntimeUpdateOverlay: showRuntimeUpdateOverlay,
        hideRuntimeUpdateOverlay: hideRuntimeUpdateOverlay,
        resetRuntimeUpdateOverlay: resetRuntimeUpdateOverlay,
        setRuntimeUpdateProgress: setRuntimeUpdateProgress,
        setRuntimeUpdateStatus: setRuntimeUpdateStatus,
        showRuntimeUpdateError: showRuntimeUpdateError,
        showInitBundlesLoading: showInitBundlesLoading,
        hideInitBundlesLoading: hideInitBundlesLoading,
        setInitBundlesProgress: setInitBundlesProgress,
        closeInitBundlesLoading: closeInitBundlesLoading,
    };
    root.closeInitBundlesLoading = closeInitBundlesLoading;
})(typeof window !== 'undefined' ? window : self);
