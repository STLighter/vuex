import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731

    // 如果window已有vue则自动安装
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    const {
      plugins = [],
      strict = false
    } = options

    // store internal state

    // 是否为commit阶段
    this._committing = false
    // 所有action的mapping
    this._actions = Object.create(null)
    // action的订阅
    this._actionSubscribers = []
    // 所有mutation的mapping
    this._mutations = Object.create(null)
    // 所有getter的mapping
    this._wrappedGetters = Object.create(null)
    // 保存所有模块的数据结构
    this._modules = new ModuleCollection(options)
    // 所有模块的mapping
    this._modulesNamespaceMap = Object.create(null)
    // mutation的订阅
    this._subscribers = []
    // vue实例用于实现对state的watch
    this._watcherVM = new Vue()

    // bind commit and dispatch to self
    // 将dispatch和commit方法的this绑定为当前store
    const store = this
    const { dispatch, commit } = this
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    // 获取根模块state作为根state
    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters

    // 从根模块开始安装各个模块, 将模块中的getters, actions, mutations带上namespace注册到mapping中
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreVM(this, state)

    // apply plugins
    plugins.forEach(plugin => plugin(this))

    if (Vue.config.devtools) {
      devtoolPlugin(this)
    }
  }

  get state () {
    return this._vm._data.$$state
  }

  set state (v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  /**
   * 根据类型调用mutation
   */
  commit (_type, _payload, _options) {
    // check object-style commit
    // 将对象形式的参数拆分出来
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    // 根据type获得对应类型的mutation数组(类型中需要包含命名空间)
    const entry = this._mutations[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    // 调用对应的mutation
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })
    // 触发订阅此类型mutation的回调
    this._subscribers.forEach(sub => sub(mutation, this.state))

    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  /**
   * 根据类型调用action
   */
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    this._actionSubscribers.forEach(sub => sub(action, this.state))

    return entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)
  }

  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }

  subscribeAction (fn) {
    return genericSubscribe(fn, this._actionSubscribers)
  }

  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  /**
   * 替换vm中的state树
   */
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  /**
   * 修改committing状态, 用于严格模式检查
   */

  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

/**
 * 将fn添加到subs数组中, 并返回一个可以将fn从subs数组中移除的函数
 */
function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

function resetStoreVM (store, state, hot) {
  // 记录原有的vm以便清空
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  // 将wrappedGetters作为vue的计算属性
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // 创建计算属性
    computed[key] = () => fn(store)
    // 将计算属性代理到getters
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  // 创建vm实现state和计算属性的响应式变化
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }
  // 如果有旧的vm, 需要将其销毁
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

/**
 * 安装一个模块
 * @param store 当前store对象
 * @param rootState 根state对象
 * @param path 当前模块/state的路径
 * @param module 当前模块
 */

function installModule (store, rootState, path, module, hot) {
  // 是否为根模块
  const isRoot = !path.length
  // 根据path获取namespace
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  // 建立namespace到此module的mapping关系
  // 只会mapping带有namespaced的模块
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  // 将当前模块的state接到父模块的state上
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 初始化本地上下文
  const local = module.context = makeLocalContext(store, namespace, path)

  // 将mutation, action, getter注册到store的mapping里面
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 递归去注册子模块
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */

/**
 * 创建module的本地上下文, 将其dispatch, commit, getters和state添加上命名空间
 * local中的值相当于此模块相关属性到store上对应属性的一个映射关系
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    // 如果包含命名空间, 则需要在type前加上namespace才能取到正确的action
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        // 添加namespace
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      // 如果包含命名空间, 则需要在type前加上namespace才能取到正确的mutation
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        // 添加namespace
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}

/**
 * 将配置中的一个mutation注册到_mutations对象上, 同名mutation均会执行
 * 所有mutation都会进行一次包裹, 通过闭包绑定module局部的state
 * _mutations是一个全局的mapping, 以便快速定位mutation
 */
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}

/**
 * 将配置中的一个action注册到_actions对象上, 同名action均会执行
 * 所有action都会进行一次包裹, 通过闭包绑定module局部的dispatch/commit/getters, 并将返回值包装成Promise
 * _actions是一个全局的mapping, 以便快速定位action
 */
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

/**
 * 将配置中的一个getter注册到_wrappedGetters对象上, commit不能重名
 * 所有getter函数都将进行一次包裹, 通过闭包绑定module局部的state/getters
 * _wrappedGetters是一个全局的mapping, 以便快速定位getter
 */
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

/**
 * 开启严格模式
 * 当state变化的时候同步检查committing, 确保是由commit修改的state
 */
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

/**
 * 以传入的state为根找到指定路径的state
 * state为树形结构
 */
function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}

/**
 * 检查入参形式, 将对象形式的commit和dispatch转为多参数形式
 */
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    // 如果是对象形式的参数, 则解析成多个参数
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

/**
 * 检查重复use并为vue对象添加初始化方法以便挂载$store
 * Vue.use时的hook
 * 详见https://cn.vuejs.org/v2/api/?#Vue-use
 */
export function install (_Vue) {
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  // 为vue对象添加初始化方法, 在初始化时挂载$store
  applyMixin(Vue)
}
