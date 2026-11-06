const envConfig = require('./config/env.config')
const express = require('express')
const helmet = require('helmet')
const cookieParser = require('cookie-parser')
const session = require('express-session')

const path = require('path')
const cors = require('cors')
const app = express()
const rateLimit = require('express-rate-limit')
const { format } = require('date-fns')

const dbConnection = require('./config/db.config')
const templateEngineConfig = require('./config/templateEngine.config')
const sessionConfig = require('./config/session.config')

const devAuth = require('./utils/devAuth')

// BEGIN::Initiating Swagger APi Documentation
const setupSwagger = require('./utils/swagger')
setupSwagger(app)
// END::Initiating Swagger APi Documentation

// BEGIN::Service Providers
const {
    baseConfig,
    authUser,
    mainNavGenerator,
    allBrands,
    nunjucksFilter,
} = require('./middleware/cms.middleware')
const { auditTrail } = require('./middleware/audit.middleware')
// END::Service Providers

app.use((req, res, next) => {
    app.locals.baseURL =
        envConfig.general.DOMAIN || req.protocol + '://' + req.get('host')
    app.locals.clientName = envConfig.general.CLIENT_NAME
    next()
})

// BEGIN::Security Headers
app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }))
app.use(helmet.frameguard({ action: 'deny' }))
app.use(helmet.xssFilter())
app.use(helmet.hidePoweredBy())
app.disable('x-powered-by')
// END::Security Headers

app.use(cors())

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// Assets folder
app.use('/cms-static', express.static(path.join(__dirname, './public')))
app.use('/static', express.static(`${process.cwd()}/public`))
app.use('/uploads', express.static(`${process.cwd()}/uploads`))

// Configure admin session storage
app.use(session(sessionConfig))

// session middleware
if (envConfig.general.NODE_ENV === 'production') {
    app.set('trust proxy', 1)
}
app.use(cookieParser())

// Template Engine
templateEngineConfig(app, path.join(__dirname, './views'))

// DB Connection
let dbSuccess = 'Fail'
let connectDB = async () => {
    dbSuccess = await dbConnection()
}
connectDB()

app.get('/health', async (req, res) => {
    const appKey =
        envConfig.general.APP_KEY === undefined ? 'APP Key is missing!!!' : 'OK'
    res.status(200).json({
        'DB Connected': dbSuccess,
        Health: 'OK',
        'App Key': appKey,
        Timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        TimeNow: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    })
})

// error handler
app.use(function (err, req, res, next) {
    console.log(req.originalUrl)
    // set locals, only providing error in development
    res.locals.message = err.message
    if (req.app.get('env') === 'development') {
        console.log(err.message)
    }
    res.locals.error = req.app.get('env') === 'development' ? err : {}
    if (req.originalUrl.includes('/api/')) {
        // return the error message
        res.status(err.status || 500).json({
            error: 'Requested API endpoint is not found',
        })
    } else {
        // render the error page
        res.status(err.status || 500)
        res.render(`admin/error-${err.status || 500}`)
    }
})

// BEGIN:: API Route Groups
const adminRoutes = require('./routes/admin/admin.routes')
const webAPIRoutes = require('./routes/api/web-api.routes')
// END:: API Route Groups

// BEGIN::Admin automatic auth on each server restart for development purpose
if (
    envConfig.general.NODE_ENV == 'development' &&
    envConfig.general.HAS_DEV_AUTH
) {
    app.use(devAuth)
}
// END::Admin automatic auth for development purpose

// Create an Apollo server instance
const setupGraphQL = require('./utils/graphql')
setupGraphQL(app)

// Apply the rate limiting middleware to API calls only
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})
app.use('/api', apiLimiter)

app.get('/', (req, res) => {
    return res.redirect('/admin')
})
app.use('/api', webAPIRoutes)
app.use(
    '/admin',
    [
        auditTrail,
        baseConfig,
        nunjucksFilter,
        authUser,
        mainNavGenerator,
        allBrands,
    ],
    adminRoutes
)

module.exports = app
