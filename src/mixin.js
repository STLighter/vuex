/**
 * 将vuexInit挂在传入的Vue对象的初始化方法上
 * vuexInit实际是给每个vue对象挂载$store
 * 兼容vue2.x和1.x
 */

export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  /**
   * 为每个vue实例对象添加$store
   */
  function vuexInit () {
    // store使用方法如下
    // const app = new Vue({
    //   el: '#app',
    //   store,
    //   ...
    // })
    // store对象将会放在根vue对象的$options中
    // 详见https://cn.vuejs.org/v2/api/#vm-options
    const options = this.$options
    // store injection
    if (options.store) {
      // options中包含store则使用这个store或其执行后的返回对象(通常在根vue对象上)
      // 如果子组件自己也加一个store就凉凉?
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      // 否则将父的$store对象拿来用(通常是非根对象)
      this.$store = options.parent.$store
    }
  }
}
