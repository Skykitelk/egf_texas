
import { _decorator, Component, Node, assetManager, ProgressBar, director } from 'cc';
import { downloadZipBundle } from './bundleLoader';
const { ccclass, property } = _decorator;
 
@ccclass('start')
export class start extends Component {

    @property(ProgressBar)
    progressBar!: ProgressBar;

    start () {
        this.progressBar.progress = 0;
    }

    onBtnLoadCached () {
        this.loadCached();
    }

    onBtnLoadManual () {
        this.loadManual();
    }

    /**
     * 加载已缓存的demo bundle (需要在构建面板初始缓存bundle中填入demo)
     */
    async loadCached() {
        assetManager.loadBundle('init_load', {
            onFileProgress: (loaded, total) => {
                this.progressBar.progress = loaded/total;
            }
        }, (err, bundle) => {
            if (err) {
                alert('load demo error' + err.message);
            } else {
                director.loadScene('init');
            }
        })
    }

    /**
     * 手动加载
     */
    async loadManual () {
        downloadZipBundle('manual_load', percent => {
            this.progressBar.progress = percent;
            if (percent === 1) {
                assetManager.loadBundle('manual_load', {
                    onFileProgress: (loaded, total) => {
                        this.progressBar.progress = loaded/total;
                    }
                }, (err, bundle) => {
                    if (err) {
                        alert('load demo error' + err.message);
                    } else {
                        director.loadScene('manual');
                    }
                })
            }
            
        }, err => {
            console.error('缓存失败', err);
        });
    }
}
