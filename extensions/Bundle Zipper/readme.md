## Bundle压缩插件
### 用途
一句话概括：让H5游戏通过下载Bundle压缩包，提高资源加载速度！

### 使用方法
插件根目录下img文件夹中是应用图标，请换成自己的。
安装好插件后，构建web-mobile或者web-desktop时，构建配置页面下发会有如下配置项

配置项 | 配置说明
---|---
应用名称 | pwa配置文件需要的字段（同时作为网页标题）
应用简称 | pwa配置文件需要的字段
访问路由 | 域名后面的路由，如果是https://xxx.com/web-mobile/，则填入/web-mobile/
初始缓存Bundle | 这些Bundle必须完成下载并缓存后，才会加载游戏，填写时以逗号间隔
压缩后删除源文件 | 根目录js文件和Bundle在压缩后全部删除
加速地址 | 如果资源和网站分离，则填入资源所在地址（目录结构必须与网站一致）

### 构建生成物

文件 | 描述
---|---
web.zip | 网站文件
cdn.zip | 配置了资源CDN才会生成，拷贝解压到【cdn地址/发布路径/】下


### 进阶使用
#### 初始缓存说明
```
项目中的js文件会打包为root压缩包（因此，游戏中请不要使用名为root的Bundle），sw安装时root包会自动下载安装
root包下载安装结束后，sw会自动下载安装配置好的【初始缓存Bundle】,全部下载并缓存结束才会进入初始场景
```
#### 调试查看
进入浏览器调试模式后，可以在CacheStorage中看到缓存的root及所有Bundle资源内容
#### 游戏中进行缓存控制
```
// 安装缓存
window.installBundle(bundleName)
// 安装进度回调
window.onBundleInstallProgress: (bundleName: string, progress: number) => void
progress=1代表全部缓存完成，此时loadBundle会全部使用本地CacheStorage缓存
// 安装错误回调
window.onBundleInstallError: (bundleName: string, error: Error) => void
// 清理Bundle过期版本(正常用不到，在installBundle后会自动调用cleanBundle)
window.cleanBundle(bundleName)
// 清理所有Bundle缓存(客户端资源万一混乱时的最终解决方案，全部删除即可)
window.cleanAllBundles()
清理结束后window.onBundlesCleanFinish接口会被调用
```
