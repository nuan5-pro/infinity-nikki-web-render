# Infinity Nikki Web Render

基于 Three.js 的 Web 渲染库，面向无限暖暖游戏画面的高性能简化还原。

当前提供家具资源加载、实例渲染和染色接口，应用负责场景、相机和渲染循环。关联项目：[BuildingMomo](https://github.com/ChanIok/BuildingMomo)。

导出 ESM TypeScript 源码，由应用构建工具编译。应用与包共用 `three` 和 `three-mesh-bvh`，支持 Three.js `>=0.183.2 <0.184.0` 的 `WebGLRenderer`。

图片解码、顶点变换和 BVH 构建由包内的模块 Worker 池处理；应用构建工具负责打包 Worker 入口，家具层统一管理资源缓存和任务取消。

## 渲染上下文

以下示例中的 `renderer`、`scene`、`camera` 和 `requestFrame` 由应用提供。

```ts
import { createRenderContext } from '@nuan5-pro/render'

const context = createRenderContext({
  renderer,
  scene,
  getCamera: () => camera,
  invalidate: requestFrame,
  lighting: () => ({
    primaryColor: [1, 1, 1],
    primaryDirection: [0, 0, -1],
    tod: { minute: 720, sunDirectionWorld: [0, 0, 1], swapLightFactor: 0 },
  }),
})

context.beforeRender()
renderer.render(scene, camera)
```

一个 context 对应一组 renderer/scene，可共享给多个家具层。`getCamera` 和 `lighting` 返回当前相机及光照，`invalidate` 请求应用重绘。每次渲染前调用 `context.beforeRender()`。

静态阴影可设置 `renderer.shadowMap.autoUpdate = false`。家具实例编辑会自动标记阴影更新；应用直接修改光源、投影物、材质遮罩或层根节点的变换/可见性后，调用 `context.invalidateShadows()`。投影物有动画时，由动画更新调用此方法。

## 家具

### 加载资源

```ts
import { createFurnitureLayer } from '@nuan5-pro/render'

const furniture = createFurnitureLayer(context, { decoderPath: '/draco/' })
await furniture.setup('/assets/furniture/')
await furniture.load([1170000315])
```

`setup(resourceRoot)` 初始化一次，加载 schema 5 的 `manifest.json` 及其相对路径资源。`decoderPath` 是独立的 Draco 解码器目录 URL。`load(assetIds)` 可选，用于预载模型并准备 GPU 资源。

### 实例编辑

```ts
import { Matrix4 } from 'three'
import type { FurnitureInstance } from '@nuan5-pro/render'

const instances: FurnitureInstance[] = [
  { id: 'chair-1', assetId: 1170000315, matrix: new Matrix4() },
]

await furniture.replaceAll(instances)
await furniture.upsert(instances)
furniture.updateMatrices([{ id: 'chair-1', matrix: new Matrix4() }])
furniture.remove(['chair-1'])
```

- `replaceAll(items)` 替换全部实例；`upsert(items)` 按 ID 新增或更新实例。
- `id` 是应用分配的稳定标识，`assetId` 对应资源中的家具 ID。
- `matrix` 使用 layer-local 坐标；源家具为 Z-up、厘米，层根节点 `furniture.root` 带 Y 镜像。
- 可选字段 `customData` 接受 `number[]` 或 `Uint32Array`，省略时使用资源默认染色。

### 染色

```ts
import { resolveCustomData } from '@nuan5-pro/render/furniture'

const config = furniture.getConfig(1170000315)
if (config) {
  const values = resolveCustomData(config, { 0: 1 })
  furniture.updateDyes([{ id: 'chair-1', values }])
}
```

`resolveCustomData(config, selections)` 将区域到方案的映射转换为原生染色值，`selections` 接受对象或 `Map<number, number>`。上例选择区域 `0` 的方案 `1`，可用值见 `config.colorings`。

直接传入染色值时，按源 mesh 索引排列无符号整数，数组长度为 `config.componentCount`。

### 资源档位

```ts
const supported = furniture.availableTiers
await furniture.setTiers({ model: 'full', material: 'lite' })
```

`model` 和 `material` 分别选择模型与材质档位，值为 `'full'` 或 `'lite'`，支持范围见 `availableTiers`。切换完成后保留实例 ID、变换和染色。

### 查询

```ts
const config = furniture.getConfig(assetId)
const bounds = furniture.getModelBounds(assetId)
const instance = furniture.getInstance(id)
const ids = furniture.getBatchInstances(assetId)
const hits = furniture.pick(raycaster)
```

- `getConfig` 返回家具配置；`getModelBounds` 返回已加载模型的 `Box3` 副本；查询缺失项时返回 `undefined`。
- `getInstance` 返回 `{ mesh, index }` 或 `undefined`。增删实例或切换档位后应重新查询。
- `getBatchInstances` 返回该资产的实例 ID 列表。
- `pick` 返回附带实例 `id` 的 Three.js 命中列表，按距离升序排列。

## 异步任务

`setup`、`load`、`replaceAll`、`upsert` 和 `setTiers` 接受可选的任务参数。

```ts
const controller = new AbortController()

await furniture.replaceAll(instances, {
  signal: controller.signal,
  onProgress: ({ phase, completed, total }) => {
    console.log(phase, completed, total)
  },
})
```

进度阶段为 `'loading'`、`'preparing'` 或 `'ready'`，按操作报告。加载与 GPU 准备并行推进，前两类进度分别累计，回调可能交错；`ready` 在实例提交后报告。调用 `controller.abort()` 取消任务，调用方处理 Promise rejection。整体替换及档位切换在准备完成后提交；新的整体替换会使旧任务失效。

## 着色质量

```ts
const furniture = createFurnitureLayer(context, {
  decoderPath: '/draco/',
  shadingQuality: 'performance',
})
```

`shadingQuality` 接受 `ShadingQuality`：

- `'original'`（默认）：原始材质效果。
- `'performance'`：简化高光、反射和植被表面细节。
- `'economy'`：进一步减少表面细节；植被受光更平坦，关闭植被发光。

该选项固定于层的生命周期，切换时重建层。模型形状、染色和透明裁剪保持一致；未支持简化的材质保留原效果。分辨率、抗锯齿和场景光照由应用设置。

应用自有材质可在首次 GPU 准备或绘制前调用：

```ts
import { applyShadingQuality } from '@nuan5-pro/render'

applyShadingQuality(terrainMaterial, 'performance', 'standard')
```

`applyShadingQuality(material, quality, family)` 原地配置并返回材质。`family` 接受 `ShadingFamily`：`'standard'`、`'surface'`、`'foliage'` 或 `'layered'`，须与材质实现匹配。透明材质和 `MeshPhysicalMaterial` 保留原效果。同一材质重复应用相同质量无额外效果，改变质量需重建材质。

直接加载植被 GLB 时，按以下顺序配置，再调用 `applyEnvironmentLighting` 和 `applyShadingQuality`；家具层已自动接入：

- `applyFoliageNormals(material)`：对 `userData.render.foliageNormals = 'authored'` 的双面、平滑 PBR 材质保留源法线方向。
- `applyFoliageTransmission(material, maskTexture?, albedoTexture?)`：消费 `userData.render.foliageTransmission`（类型 `FoliageTransmission`）。按 `mask` / `albedo` 声明传入原始纹理并保留源色域，纹理由调用方释放；`vertex` 声明要求几何提供 `foliageRed` 标量属性，`cycle` 要求专用 foliage 材质的日夜图集。

两者均原地返回材质，重复调用无额外效果，未声明对应元数据时保持原样。

## 资源释放

```ts
const { materials, models, shaders } = furniture.getResourceStats()
furniture.clearUnused()
furniture.dispose()
context.dispose()
```

`getResourceStats()` 返回数量：`materials` 为已缓存家具的去重渲染材质数，`models` 为已缓存家具种类数（均含闲置资源），`shaders` 为整个 renderer 的程序数。这些指标不是显存字节数。`canClearCache` 表示是否有可释放的预载、闲置资产或底层资源缓存。

`clearUnused()` 释放预载和闲置缓存；`furniture.dispose()` 释放单层；`context.dispose()` 释放所有层及内部资源。应用管理 renderer、scene 和 camera 的生命周期。

WebGL 上下文恢复期间暂停绘制。应用可通过 `createRenderContext` 的 `onContextRestored` 回调重建自己持有的预计算渲染目标。
