/**
 * Get the first item that pass the test
 * by second argument function
 *
 * @param {Array} list
 * @param {Function} f
 * @return {*}
 */

 /**
  * 返回list中第一个满足判断条件fn的元素
  * 与等价于list.find(f)
  */
export function find (list, f) {
  return list.filter(f)[0]
}

/**
 * Deep copy the given object considering circular structure.
 * This function caches all nested objects and its copies.
 * If it detects circular structure, use cached copy to avoid infinite loop.
 *
 * @param {*} obj
 * @param {Array<Object>} cache
 * @return {*}
 */

 /**
  * 考虑循环引用的深拷贝, 只考虑普通对象的深拷贝
  * 利用cache数组将已遍历对象缓存, 通过在cache数组中查找确定是否为循环引用
  * 循环引用时直接返回初次遍历时对应拷贝的对象
  */
export function deepCopy (obj, cache = []) {
  // just return if obj is immutable value
  // 基础类型和function直接返回
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  // if obj is hit, it is in circular structure
  // 先在缓存中查找, 找到说明之前已经拷贝过这个对象
  const hit = find(cache, c => c.original === obj)
  if (hit) {
    // 已经拷贝过的对象, 直接返回之前拷贝得到的对象
    return hit.copy
  }

  // 分为拷贝数组和普通对象两种情况
  const copy = Array.isArray(obj) ? [] : {}
  // put the copy into cache at first
  // because we want to refer it in recursive deepCopy
  // 将要拷贝的对象和拷贝出的对象放入cache中, 以便查找和返回拷贝对象
  // 此时push进cache中的拷贝对象并未拷贝完全
  cache.push({
    original: obj,
    copy
  })

  // 递归拷贝
  Object.keys(obj).forEach(key => {
    // 将obj[key]的拷贝结果给copy[key]
    copy[key] = deepCopy(obj[key], cache)
  })

  // 返回obj的拷贝结果
  return copy
}

/**
 * forEach for object
 */
 
/**
* 枚举obj每个属性以其为参数并调用fn
*/
export function forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}

export function isObject (obj) {
  return obj !== null && typeof obj === 'object'
}

export function isPromise (val) {
  return val && typeof val.then === 'function'
}

export function assert (condition, msg) {
  if (!condition) throw new Error(`[vuex] ${msg}`)
}
