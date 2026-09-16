function mainStart() {
    if (!_start_success) return EXIT_FAILURE

  // ① 创建主场景树（MainLoop）——默认分支 memnew(SceneTree)
   const mainLoop = memnew(SceneTree)
  OS.getSingleton().setMainLoop(mainLoop)          // 交给 OS 持有

  // [autoload] 单例先挂到 root（此处略）
  // ...

  const sml = Object.castTo(mainLoop, SceneTree)
  if (!sml) return EXIT_FAILURE

  // 游戏模式
  if (!project_manager && !editor) {
    if (!game_path.isEmpty()) {
      // ③ 读取主场景，实例化出节点树
      const scenedata = ResourceLoader.load(local_game_path)   // .tscn → PackedScene
      let scene = null
      if (scenedata.isValid()) scene = scenedata.instantiate() // → SceneState::instantiate()
      if (scene == null) return EXIT_FAILURE

      // ④ 把主场景挂到 root
      sml.addCurrentScene(scene)                               // root.addChild(scene)
    }
  }
  return EXIT_SUCCESS
}

// ════════════════════════════════════════════════════════════════
//  SceneTree —— 对应 SceneTree::SceneTree()  （scene/main/scene_tree.cpp:2050）
// ════════════════════════════════════════════════════════════════
class SceneTree extends MainLoop {
  constructor() {
    super()

    // ② 创建 root 节点（一个 Window / Viewport）
    this.root = memnew(Window)                      // ← root 在这里诞生
    this.root.setMinSize(new Vector2i(64, 64))
    this.root.setProcessMode(Node.PROCESS_MODE_PAUSABLE)
    this.root.setName("root")
    this.root.setTitle(GLOBAL_GET("application/config/name"))

    // 大量 Viewport 配置（MSAA/TAA/HDR/shadow/world_3d/Environment…）
    this.root.setWorld3d(memnew(World3D))
    this.root.setAsAudioListener2d(true)
    this.root.setAsAudioListener3d(true)
    this.root.setPhysicsObjectPicking(GLOBAL_DEF("physics/common/enable_object_picking", true))
    // ...

    this.root.connect("close_requested", () => this._mainWindowClose())
    this.currentScene = null
    this.pendingNewSceneId = null
    this.prevSceneId = null
  }

  // ④ 对应 SceneTree::add_current_scene()  （scene_tree.cpp:1762）
  addCurrentScene(pCurrent) {
    assertIsMainThread()
    this.currentScene = pCurrent
    this.root.addChild(pCurrent)        // ← 挂到 root（此时尚未真正入树）
  }

  // 运行期换场景（延迟到帧末）——对应 change_scene_to_node / _flush_scene_change
  changeSceneToPacked(pScene) {
    const newScene = pScene.instantiate()          // scene_tree.cpp:1716
    return this.changeSceneToNode(newScene)
  }
  changeSceneToNode(pNode) {
    if (this.currentScene) {
      this.prevSceneId = this.currentScene.getInstanceId()
      this.root.removeChild(this.currentScene)      // 先摘掉旧场景
    }
    this.pendingNewSceneId = pNode.getInstanceId() // 暂存，不立即挂
    return OK
  }
  _flushSceneChange() {                              // 帧末才真正挂（scene_tree.cpp:1673）
    if (this.prevSceneId) { const p = ObjectDB.getInstance(this.prevSceneId) 
        if (p) memdelete(p) }
    const pending = ObjectDB.getInstance(this.pendingNewSceneId)
    if (pending) {
      this.currentScene = pending
      this.pendingNewSceneId = null
      this.root.addChild(pending)                   // ← 换场景时的挂载点
    }
  }

  // ⑤ 真正让整棵树进入 SceneTree  —— scene_tree.cpp:586
  initialize() {
    if (this.root == null) return
    super.initialize()
    this.root._setTree(this)        // ← 一切 enter_tree / ready 从这里开始
  }

  // 逐帧驱动
  process(delta) {
    // 55555 各节点 _process / timers / tweens ...
    if (this.pendingNewSceneId) this._flushSceneChange()
    this._flushDeleteQueue()
    return this.quitRequested
  }
}

// ════════════════════════════════════════════════════════════════
//  ③ 实例化节点树 —— 对应 SceneState::instantiate()  （scene/resources/packed_scene.cpp:155）
// ════════════════════════════════════════════════════════════════
function instantiateScene(sceneState, editState) {
  const retNodes = []               // 每个 NodeData → 一个 Node 实例
  const deferredNodePaths = []      // NodePath 属性延后到树建好再解析

  for (let i = 0 ;i < sceneState.nodes.length; i++) {
    const n = sceneState.nodes[i]
    let node, parent = i > 0 ? retNodes[n.parent & FLAG_MASK] : null

    // ---- 建节点：三种来源 ----
    if (i === 0 && sceneState.baseSceneIdx >= 0) {
      node = sceneState.props[sceneState.baseSceneIdx].instantiate()     // 继承的根场景
    } else if (n.instance >= 0) {
      node = sceneState.props[n.instance & FLAG_MASK].instantiate()      // 子场景实例（递归）
    } else if (n.type === TYPE_INSTANTIATED) {
      node = parent.getChildByName(sceneState.names[n.name])            // 已存在于继承树
    } else {
      // ★ 真正的"新建节点"
      const obj = ClassDB.instantiate(sceneState.names[n.type])         // packed_scene.cpp:318
      node = Object.castTo(obj, Node)
      if (!node) node = memnew(Node)                                    // 类缺失 → 占位
    }
    if (!node) continue

    // ---- 恢复属性 / 脚本 / 组 ----
    for (const p of n.properties) {
      if (p.isNodePathProp()) { deferredNodePaths.push({ base: node, prop: p.name, value: p.value }) 
        continue }
      if (sceneState.names[p.name] === "script") node.setScript(sceneState.props[p.value])
      else node.set(sceneState.names[p.name], sceneState.props[p.value]) // packed_scene.cpp:494
    }
    for (const g of n.groups) node.addToGroup(sceneState.names[g], true)

    // ---- 挂到父节点，连成内存树 ----
    if (i > 0) {
      if (parent) {
        parent._addChildNocheck(node, sceneState.names[n.name])         // packed_scene.cpp:543
        if (n.index >= 0) parent.moveChild(node, n.index)
      }
    } else {
      node._setNameNocheck(sceneState.names[n.name])                    // i==0：根节点
    }

    // ---- 设置 owner（决定节点归属哪个场景）----
    if (n.owner >= 0) node._setOwnerNocheck(retNodes[n.owner & FLAG_MASK]) // packed_scene.cpp:570

    retNodes[i] = node
  }

  // 解析延后的 NodePath 属性（此时整棵树已存在）
  for (const dnp of deferredNodePaths) dnp.base.set(dnp.prop, dnp.base.getNodeOrNull(dnp.value))

  // 恢复信号连接
  for (const c of sceneState.connections) {
    if (!retNodes[c.from] || !retNodes[c.to]) continue
    retNodes[c.from].connect(sceneState.names[c.signal],
                             new Callable(retNodes[c.to], sceneState.names[c.method]))
  }

  return retNodes[0]                 // 返回子树根节点
}

// ════════════════════════════════════════════════════════════════
//  ④ 挂载 —— 对应 Node::add_child() / _add_child_nocheck()  （scene/main/node.cpp:1711 / 1664）
// ════════════════════════════════════════════════════════════════
class Node {
  constructor() {                     // 对应 Node::Node()  node.cpp:4092
    this.data = {
      name: "", parent: null, tree: null, depth: 0, viewport: null,
      children: new Map(), childrenCache: [], childrenCacheDirty: false,
      process: false, physicsProcess: false, processMode: PROCESS_MODE_INHERIT,
      readyNotified: false, readyFirst: true, owner: null, groups: new Map(),
    }
  }

  addChild(pChild, forceReadableName = false) {                       // node.cpp:1711
    assertIsMainThread()
    if (pChild === this) return                 // 不能把自己当子节点
    if (pChild.data.parent) return              // 已有父节点
    if (pChild.isAncestorOf(this)) return       // 防止成环
    this._validateChildName(pChild, forceReadableName)
    this._addChildNocheck(pChild, pChild.data.name)
  }

  _addChildNocheck(pChild, pName) {                                   // node.cpp:1664
    pChild.data.name = pName
    this.data.children.set(pName, pChild)
    pChild.data.parent = this
    this.data.childrenCacheDirty = true          // 缓存失效，下次重建

    pChild.notification(NOTIFICATION_PARENTED)   // 父变更通知

    // ★ 关键：父节点已在树里才让子树入树；启动时 root.tree 仍是 null，故此处不触发
    if (this.data.tree) {
      pChild._setTree(this.data.tree)
    }
    this.notification(NOTIFICATION_CHILD_ORDER_CHANGED)
  }

  // ⑤ 真正入树 —— 对应 Node::_set_tree()  node.cpp:3354
  _setTree(pTree) {
    let treeChangedA = null
    if (this.data.tree) { this._propagateExitTree() 
        treeChangedA = this.data.tree }

    this.data.tree = pTree

    if (this.data.tree) {
      this._propagateEnterTree()                                          // 自顶向下
      if (!this.data.parent || this.data.parent.data.readyNotified) {
        this._propagateReady()                                           // 自底向上
      }
    }
  }

  _propagateEnterTree() {                                               // node.cpp:341
    if (this.data.parent) { this.data.tree = this.data.parent.data.tree 
        this.data.depth = this.data.parent.data.depth + 1 }
    else this.data.depth = 1
    this.data.viewport = Object.castTo(this, Viewport) ?? this.data.parent?.data.viewport

    for (const [k] of this.data.groups) this.data.tree.addToGroup(k, this)

    this.notification(NOTIFICATION_ENTER_TREE)
    this.emitSignal("tree_entered")
    this.data.tree.nodeAdded(this)

    for (const [, child] of this.data.children) {
      if (!child.isInsideTree()) child._propagateEnterTree()              // 递归子节点
    }
  }

  _propagateReady() {                                                   // node.cpp:323
    this.data.readyNotified = true
    for (const [, child] of this.data.children) child._propagateReady()   // 子先于父
    this.notification(NOTIFICATION_POST_ENTER_TREE)
    if (this.data.readyFirst) { this.data.readyFirst = false
         this.notification(NOTIFICATION_READY)
          this.emitSignal("ready") }
  }
}

// ════════════════════════════════════════════════════════════════
//  ⑤' 平台层入口 —— 对应 OS::run()  （platform/*/os_*.cpp）
// ════════════════════════════════════════════════════════════════
function osRun() {
  const err = mainStart()             // Main::start()：建树 + 挂 root
  if (err !== EXIT_SUCCESS) return

  OS.getSingleton().getMainLoop().initialize()   // ← SceneTree::initialize → root._set_tree()

  while (true) {                                 // Main::iteration() 主循环
    if (OS.getSingleton().getMainLoop().process(delta)) break
  }
}