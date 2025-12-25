import { Telegraf, Scenes, session, Markup } from 'telegraf'
import dotenv from 'dotenv'
import moment from 'moment-timezone'
// import { Context as TelegrafContext } from 'telegraf'

dotenv.config()

interface CheckinWizardSession extends Scenes.WizardSessionData {
  arrival?: string
  barPhoto?: any
  uniform?: string
  uniformPhoto?: any
}


type MyContext = Scenes.WizardContext<CheckinWizardSession>

function getState(ctx: MyContext): CheckinWizardSession {
  return ctx.wizard.state as CheckinWizardSession
}

const bot = new Telegraf<MyContext>(process.env.BOT_TOKEN!)
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID!
const timezone = 'Asia/Almaty'

const userCheckins = new Map<number, string>()



bot.on('photo', async (ctx, next) => {
  if (ctx.chat?.type === 'private') {
    const from = ctx.from
    if (from) {
      const caption = `Фото от @${from.username || from.first_name}`
      await ctx.telegram.copyMessage(GROUP_CHAT_ID, ctx.chat.id, ctx.message.message_id, {
        caption,
      })
    }
  }
  return next()
})

const checkinWizard = new Scenes.WizardScene<MyContext>(
  'checkin-wizard',

  async (ctx) => {
    const from = ctx.from
    if (!from) return ctx.reply('err on 48')

    await ctx.reply(
      `Привет, ${from.first_name}! Начнём чек-лист открытия смены. Отмечай каждый пункт и прикрепляй фото.`
    )
    await ctx.reply(
      'Ты пришёл на смену не позже 07:30?',
      Markup.keyboard([['Да', 'Нет']]).oneTime().resize()
    )
    return ctx.wizard.next()
  },

  async (ctx) => {
    const text = (ctx.message as any)?.text
    if (!text) return ctx.reply('Пожалуйста, выберите Да или Нет')
    getState(ctx).arrival = text

    await ctx.reply('Загрузи фото бара (общий вид)')
    return ctx.wizard.next()
  },

  async (ctx) => {
    const msg = ctx.message as any
    if (!msg.photo) {
      await ctx.reply('Пришлите фото бара')
      return
    }
    getState(ctx).barPhoto = msg
    await ctx.reply('Форма чистая, внешний вид соответствует стандарту?')
    return ctx.wizard.next()
  },

  async (ctx) => {
    const text = (ctx.message as any)?.text
    if (!text) return ctx.reply('Пожалуйста, ответьте Да или Нет')
    getState(ctx).uniform = text

    await ctx.reply('Отправь селфи в форме :)')
    return ctx.wizard.next()
  },

  async (ctx) => {
    const msg = ctx.message as any
    if (!msg.photo) {
      await ctx.reply('Нужно фото формы ((')
      return
    }
    getState(ctx).uniformPhoto = msg

    const from = ctx.from
    if (!from) return ctx.reply('err on 98')

    const state = getState(ctx)
    const summary = `Чек-лист открытия завершён от @${from.username || from.first_name}

   Приход вовремя: ${state.arrival}
   Внешний вид: ${state.uniform}`

    await ctx.reply('Спасибо! Отчёт отправлен шефу. Отличной смены 💪')
    await ctx.telegram.sendMessage(GROUP_CHAT_ID, summary)
    return ctx.scene.leave()
  }
)

const checkoutWizard = new Scenes.WizardScene<MyContext>(
  'checkout-wizard',
// нужно тестить как отображается текст
  async (ctx) => {
    await ctx.reply(
      `Смена подходит к концу. Заполни чек-лист закрытия — это важно для порядка и передачи следующей смене!\n\n` +
        `Отправь по одному фото на каждый пункт (можно сразу всё подряд):\n\n` +
        `1️⃣ Промывка оборудования\n• Холдеры, группа, форсунка, решётки, кофемашина\n` +
        `2️⃣ Холодильник, продукты, сиропы\n3️⃣ Ледогенератор, питчеры, раковина, поверхность\n` +
        `4️⃣ Соковыжималка, блендер, мусор, витрина\n5️⃣ Передача смены — да/нет\n` +
        `6️⃣ Комментарий (необязательно): были ли сложности, жалобы, поломки\n\n` +
        `Когда всё отправлено — нажми "Завершить чек-лист"`,
      Markup.keyboard([['Завершить чек-лист']]).resize()
    )
    return ctx.wizard.next()
  },

  async (ctx) => {
    const from = ctx.from
    if (!from) return ctx.reply('Ошибка: не удалось определить пользователя.')

    const userId = from.id
    const userName = from.username || from.first_name

    if ((ctx.message as any)?.text !== 'Завершить чек-лист') {
      return ctx.reply('Нажмите кнопку - Завершить чек-лист чтобы закончить')
    }

    const checkinTime = moment(userCheckins.get(userId)).tz(timezone)
    const checkoutTime = moment().tz(timezone)
    const duration = moment.duration(checkoutTime.diff(checkinTime))
    const hours = duration.hours()
    const minutes = duration.minutes()

    userCheckins.delete(userId)

    const msg = `Бариста @${userName} завершил смену\n\n Чек-ин: ${checkinTime.format(
      'HH:mm'
    )}\n Чек-аут: ${checkoutTime.format('HH:mm')}\n Отработано: ${hours} ч ${minutes} мин\n Чек-лист отправлен.`

    await ctx.reply('Спасибо! Отчёт принят. Отличная работа 💪')
    await ctx.telegram.sendMessage(GROUP_CHAT_ID, msg)
    return ctx.scene.leave()
  }
)

const stage = new Scenes.Stage<MyContext>([checkinWizard, checkoutWizard])

bot.use(session())
bot.use(stage.middleware())

bot.command('checkin', async (ctx) => {
  const from = ctx.from
  if (!from) return ctx.reply('Ошибка: не удалось определить пользователя.')

  const userId = from.id
  const now = moment().tz(timezone).toISOString()

  if (userCheckins.has(userId)) {
    await ctx.reply(' Вы уже начали смену. Используйте /checkout чтобы закончить.')
    return
  }

  userCheckins.set(userId, now)
  const readableTime = moment(now).tz(timezone).format('HH:mm, DD MMMM')
  await ctx.reply(`Чек-ин зарегистрирован: ${readableTime}`)

  await ctx.scene.enter('checkin-wizard')
})

bot.command('checkout', async (ctx) => {
  const from = ctx.from
  if (!from) return

  const userId = from.id
  if (!userCheckins.has(userId)) {
    await ctx.reply('Сначала нужно сделать чек-ин командой /checkin.')
    return
  }

  await ctx.scene.enter('checkout-wizard')
})

bot.launch().then(() => console.log('start'))
