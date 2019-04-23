const Sequelize = require('sequelize')
const { Utils } = require('zignis')
const co = require('co')
const fs = require('fs')
const consulCommand = require('../commands/zhike/consul')

class DatabaseLoader {
  constructor(options) {
    this.options = Object.assign(
      {},
      {
        loadReturnInstance: false,
        readonly: false
      },
      options
    )
    this.instances = {}
  }

  get Sequelize() {
    return Sequelize
  }

  get Op() {
    return Sequelize.Op
  }

  /**
   * 获取数据库配置，可以直接被 Sequelize CLI 解析
   * @param {string|array} consulKey
   */
  config(consulKey) {
    return co(function*() {
      let dbConfig
      if (Utils._.isObject(consulKey)) {
        dbConfig = consulKey
      } else {
        const { result } = yield consulCommand.handler({ keys: [consulKey], silent: true })
        dbConfig = Utils._.get(result, consulKey)
      }

      if (!dbConfig) {
        throw new Error('consulKey not exist')
      }

      if (dbConfig.options) {
        dbConfig = Object.assign({}, dbConfig, dbConfig.options)
      }

      if (dbConfig.user && !dbConfig.username) {
        dbConfig.username = dbConfig.user
      }

      return dbConfig
    })
  }

  /**
   * 实例化数据库连接，数据库配置可以从 consul 取，也可以直接传给 load 方法
   * @param {string|array} consulKey
   * @param {string} instanceKey
   * @param {function} callback
   */
  load(consulKey, instanceKey = '', callback) {
    let that = this
    return co(function*() {
      if (Utils._.isFunction(instanceKey) || Utils._.isArray(instanceKey)) {
        callback = instanceKey
        instanceKey = consulKey
      } else if (Utils._.isString(instanceKey)) {
        instanceKey = instanceKey || Utils._.isString(consulKey) ? consulKey : Utils.md5(JSON.stringify(consulKey))
      } else {
        throw new Error('Undefined argument type!')
      }
      

      // init db only once
      if (that.instances[instanceKey]) {
        return that.instances[instanceKey]
      }

      let dbConfig
      if (Utils._.isObject(consulKey)) {
        if (!instanceKey) {
          throw new Error('The second parameter:instanceKey is required!')
        }
        dbConfig = consulKey
      } else {
        const { result } = yield consulCommand.handler({ keys: [consulKey], silent: true })
        dbConfig = Utils._.get(result, consulKey)
      }

      if (!dbConfig) {
        throw new Error('consulKey not exist')
      }

      if (dbConfig.options) {
        dbConfig = Object.assign({}, dbConfig, dbConfig.options)
      }

      if (dbConfig.user && !dbConfig.username) {
        dbConfig.username = dbConfig.user
      }

      let sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
        dialect: dbConfig.dialect,
        operatorsAliases: false,
        host: dbConfig.host,
        port: dbConfig.port,
        timezone: '+08:00',
        logging: undefined,
        pool: {
          maxConnections: dbConfig.pool
        }
      })

      function forbiddenMethod() {
        throw new Error('Dangerous method forbidden!')
      }

      // 防止误操作，删除、清空整个库
      sequelize.drop = forbiddenMethod // 删除所有的表
      sequelize.truncate = forbiddenMethod // 清空所有的表
      sequelize.dropAllSchemas = forbiddenMethod // 删除所有的 postgres schema，即删掉整个数据库
      sequelize.dropSchema = forbiddenMethod // 删除一个 postgres schema，一般也相当于删掉整个数据库

      yield sequelize.authenticate()

      that.instances[instanceKey] = sequelize

      const queryInterface = sequelize.getQueryInterface()
      const tables = yield queryInterface.showAllTables()
      const tableInfos = yield Promise.all(
        tables.map(table => {
          return queryInterface.describeTable(table)
        })
      )

      const combinedTableInfos = Utils._.zipObject(tables, tableInfos)
      Object.keys(combinedTableInfos).forEach(table => {
        const tableInfo = combinedTableInfos[table]
        const newTableInfo = {}
        const newTableFields = []
        Object.keys(tableInfo).map(field => {
          const newField = field.replace(/(_.)/g, function(word) {
            return word[1].toUpperCase()
          })

          tableInfo[field].field = field
          // for PG, check autoIncrement rule
          if (/^nextval\(.*?::regclass\)$/.test(tableInfo[field].defaultValue)) {
            delete tableInfo[field].defaultValue
            tableInfo[field].autoIncrement = true
          }

          newTableInfo[newField] = tableInfo[field]
          newTableFields.push(newField)
        })
        const modelName =
          table.indexOf(dbConfig.prefix) > -1
            ? table.substring(dbConfig.prefix.length).replace(/(_.)/g, function(word) {
                return word[1].toUpperCase()
              })
            : table.replace(/(_.)/g, function(word) {
                return word[1].toUpperCase()
              })
        const modelNameUpper = modelName.replace(/( |^)[a-z]/g, L => L.toUpperCase())

        try {
          let options = {
            tableName: table
          }

          if (newTableFields.indexOf('createdAt') === -1) {
            options.createdAt = false
          }

          if (newTableFields.indexOf('updatedAt') === -1) {
            options.updatedAt = false
          }

          let model = sequelize.define(modelNameUpper, newTableInfo, options)
          model.drop = forbiddenMethod // 以防误删表
          model.sync = forbiddenMethod

          if (that.options.readonly && process.env.NODE_ENV === 'production') {
            model.upsert = forbiddenMethod
            model.truncate = forbiddenMethod
            model.destroy = forbiddenMethod
            model.restore = forbiddenMethod
            model.update = forbiddenMethod
            model.create = forbiddenMethod
            model.findOrCreate = forbiddenMethod
            model.findCreatefFnd = forbiddenMethod
            model.bulkCreate = forbiddenMethod
            model.removeAttribute = forbiddenMethod
          }
        } catch (e) {}
      })

      if (Utils._.isArray(callback)) {
        callback.map(cb => {
          if (Utils._.isFunction(cb)) {
            cb(sequelize.models, sequelize)
          } else if (Utils._.isString(cb)) {
            // implicitly means to call this.associate, and cb is actually modealPath
            that.associate(cb)(sequelize.models, sequelize)
          }
        })
      } else {
        if (Utils._.isFunction(callback)) {
          callback(sequelize.models, sequelize)
        } else if (Utils._.isString(callback)) {
          // implicitly means to call this.associate, and callback is actually modealPath
          that.associate(callback)(sequelize.models, sequelize)
        }
      }
      
      if (that.options.loadReturnInstance) {
        return that.instances[instanceKey]
      }
    }).catch(e => {
      throw new Error(e.stack)
    })
  }

  /**
   * 处理模型的关联关系
   * @param {string} modelPath
   */
  associate(modelPath) {
    return function(models, sequelize) {
      Object.keys(models).forEach(modelName => {
        if (fs.existsSync(`${modelPath}/${modelName}.js`)) {
          let model = sequelize.models[modelName]
          let modelExtend = require(`${modelPath}/${modelName}`)
          if (Utils._.isFunction(modelExtend)) {
            const ret = modelExtend.bind(model)(sequelize.models, sequelize)
            if (ret) {
              sequelize.models[modelName] = ret
            }
          } else {
            throw new Error('Model extension must be a function.')
          }
        }
      })
    }
  }
}

module.exports = DatabaseLoader
