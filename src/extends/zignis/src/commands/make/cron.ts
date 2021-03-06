import fs from 'fs'
import path from 'path'
import { Utils } from 'zignis'

export const command = 'cron <name>'
export const desc = 'Generate a zignis cron job file'

export const builder = function(yargs: any) {
  yargs.option('typescript', {
    alias: 'ts',
    describe: 'generate typescript style code'
  })
}

export const handler = function(argv: any) {
  const cronDir = argv.cronMakeDir || argv.cronDir
  if (!cronDir || !fs.existsSync(cronDir)) {
    console.log(Utils.chalk.red('"cronDir" missing in config file or not exist in current directory!'))
    return
  }

  const filePrefix = Utils.day().format('YYYYMMDDHHmmssSSS')
  const cronFile = path.resolve(cronDir, `${filePrefix}_${Utils._.kebabCase(argv.name)}.${argv.typescript ? 'ts' : 'js'}`)
  if (fs.existsSync(cronFile)) {
    console.log(Utils.chalk.red('Script file exist!'))
    return
  }

  let code
  if (argv.typescript) {
    code = `const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 示例 Job Actions
const demoAction = async function demo() {
  console.log('Demo job action')
  await sleep(60000)
}

export const schedule = '* * * * *'
export const duration = 60000
export const actions = [demoAction]
export const disabled = false
export const env = 'production'
`
  } else {
    code = `const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 示例 Job Actions
const demoAction = async function demo() {
  console.log('Demo job action')
  await sleep(60000)
}

exports.schedule = '* * * * *'
exports.duration = 60000
exports.actions = [demoAction]
exports.disabled = false
`
  }


  if (!fs.existsSync(cronFile)) {
    fs.writeFileSync(cronFile, code)
    console.log(Utils.chalk.green(`${cronFile} created!`))
  }
}
