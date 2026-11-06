const envConfig = require('../config/env.config')
const _ = require('lodash')
const path = require('path')
const Brand = require('../model/Brand')
const Settings = require('../model/Settings')
const ContentType = require('../model/ContentType')
const { default: collect } = require('collect.js')
const { navConfig, getBaseNavConfig } = require('../config/admin.config')
const { convertToSingular } = require('../helper/General.helper')
const { privileges } = require('../config/userPrivilege.config')
const { default: slugify } = require('slugify')
const { getCache, setCache } = require('../helper/Redis.helper')
const {
    getBrandSettings,
    getBrandsFromCache,
    getBrand,
} = require('../helper/Cache.helper')
const { format } = require('date-fns')
const { formatInTimeZone } = require('date-fns-tz')

// Getting custom navigation from cms-wrapper config
let customNavConfig
try {
    customNavConfig = require(
        `${path.dirname(require.main.filename)}/config/admin.config.js`
    )
} catch (error) {
    customNavConfig = []
}

// Only absolute http(s) URLs or site-relative paths count as a logo; anything else
// (empty, "undefined", a bare word, a typo'd scheme) falls back to the client name.
const usableLogoUrl = (value) => {
    const url = String(value || '').trim()
    if (!url || /\s/.test(url)) return ''
    if (/^https?:\/\/[^/]+/i.test(url) || /^\/(?!\/)/.test(url)) return url
    return ''
}

const clientInitials = (name = '') =>
    String(name)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('')

const baseConfig = async (req, res, next) => {
    const clientName = `${envConfig.general.CLIENT_NAME}`
    const logoLarge = usableLogoUrl(envConfig.general.CMS_LOGO_LARGE)
    res.locals.browserTitle = clientName
    res.locals.clientInitials = clientInitials(clientName)
    res.locals.cmsLogoLarge = logoLarge
    res.locals.cmsLogoSmall = usableLogoUrl(envConfig.general.CMS_LOGO_SMALL) || logoLarge
    res.locals.globalModuleConfig = globalModuleConfig
    res.locals.hasEcommerce = envConfig.general.HAS_ECOMMERCE
    res.locals.LANDING_URL = envConfig.general.ADMIN_LANDING_URL
    res.locals.currentYear = new Date().getFullYear()
    next()
}

const nunjucksFilter = async (req, res, next) => {
    // Converting the date object dd-mm-yyyy format
    res.locals.convertDateToDMY = (date) => {
        if (date) {
            return format(date, 'dd-MM-yyyy')
        } else {
            return null
        }
    }

    res.locals.convertDateCustom = (date, dateFormat = 'dd-MM-yyyy') => {
        if (date) {
            return format(new Date(date), dateFormat)
        } else {
            return null
        }
    }
    // Stringify the json object
    res.locals.jsonToString = (json) => {
        if (json) {
            return JSON.stringify(json)
        } else {
            return null
        }
    }
    // Convert plural to singular
    res.locals.pluralToSingular = (plural) => {
        return convertToSingular(plural)
    }

    res.locals.brandCountryMatch = (domains, country) => {
        return collect(domains)
            .pluck('country')
            .toArray()
            .some((item) => {
                return String(item) === String(country)
            })
    }

    res.locals.mathRandom = () => {
        return Math.floor(Math.random() * 1000 + 1)
    }

    res.locals.checkAnyChildPathAllowed = (
        allowedURLs = [],
        child = [],
        authUser = {}
    ) => {
        if (
            authUser?.admin_role === 'super_admin' ||
            authUser?.admin_role === 'admin'
        ) {
            return true
        }
        return child.some((item) => {
            return allowedURLs.includes(item.path)
        })
    }

    res.locals.checkPathAllowed = (allowedURLs = [], path, authUser) => {
        if (
            authUser?.admin_role === 'super_admin' ||
            authUser?.admin_role === 'admin'
        ) {
            return true
        }
        return allowedURLs.includes(path)
    }

    res.locals.checkSectionAllowed = (
        allowedSections = [],
        section,
        authUser
    ) => {
        if (
            authUser?.admin_role === 'super_admin' ||
            authUser?.admin_role === 'admin'
        ) {
            return true
        }
        return allowedSections.includes(section)
    }

    res.locals.findAttachedContent = (contentDetail, attachedItem, content) => {
        return contentDetail?.attached_type?.find((type) => {
            let itemFound =
                type.content_type == attachedItem &&
                type.items?.length &&
                type.items.find(
                    (at) => at?.toString() == content._id?.toString()
                )

            if (itemFound) {
                return true
            }
        })
    }

    res.locals.findAttachedProduct = (contentDetail, productId) => {
        return contentDetail?.products?.find((product) => {
            console.log('product', product)
            let itemFound = product._id?.toString() == productId?.toString()
            if (itemFound) {
                return true
            }
        })
    }

    res.locals.formatDateTimeInTimezone = (
        date,
        timezone = 'Asia/Kolkata',
        dateFormat = 'dd-MM-yyyy HH:ii:ss'
    ) => {
        try {
            if (date) return formatInTimeZone(date, timezone, dateFormat)
            return null
        } catch (error) {
            logError(error)
            return null
        }
    }

    res.locals.json = (obj) => {
        return JSON.stringify(obj)
    }

    res.locals.htmlSlice = (value, start, end) => {
        // Handle null, undefined, or non-string values
        if (value == null || typeof value !== 'string') {
            return ''
        }
        const text = value.replace(/<[^>]*>?/gm, '') // Remove HTML tags
        return text.slice(start, end) // Return sliced text
    }

    res.locals.in_array = (ar, val) => {
        return Array.isArray(ar) && ar.includes(val)
    }

    res.locals.ObjectKeys = (obj) => {
        return Object.keys(obj)
    }

    res.locals.keys = (obj) => {
        return Object.keys(obj)
    }

    res.locals.log = (value) => {
        console.log(value)
        return value // Return the value to ensure it continues rendering
    }

    res.locals.arrayIncludes = (array, value) => {
        let stringifiedArray = array.map((item) => item?.toString())
        return stringifiedArray.includes(value?.toString())
    }

    next()
}

const contentTypeCheck = async (req, res, next) => {
    if (!req.params.contentType) {
        return res.status(404).json({
            error: 'Content type not found',
        })
    }
    try {
        const contentType = await ContentType.findOne({
            slug: req.params.contentType,
            brand: { $in: [req.session.brand._id] },
        })
        if (!contentType) {
            return res.render(`admin-njk/page-error-404`)
        }
        req.contentType = contentType
        next()
    } catch (err) {
        logError(err)
        return res.status(404).json({
            error: 'Content type not found',
        })
    }
}

const getNavigation = async (req) => {
    // preBuildNav is the navigation declared in the config folder of cms-package

    const navConfig = await getBaseNavConfig()
    let preBuildNav = _.cloneDeep(navConfig)

    // customBuildNav is the navigation declared in the config folder of cms-wrapper
    let customBuildNav = _.cloneDeep(customNavConfig || [])

    // Finding index of the section in preBuildNav
    const findSectionIndex = (section) => {
        // This will return the index of the section if it exists otherwise it will return -1
        return _.findIndex(customBuildNav, { section })
    }

    // Returning the value of the is_hidden attribute
    const checkSectionIsHidden = (nav, index) => {
        return nav[index]?.is_hidden
    }

    // Looping through preBuildNav
    _.forEach(preBuildNav, (preBuildSection) => {
        const sectionIndex = findSectionIndex(preBuildSection.section)

        if (sectionIndex !== -1) {
            // Section already exists in customBuildNav
            // Checking the section is hidden or not
            if (checkSectionIsHidden(customBuildNav, sectionIndex)) {
                // If section is hidden then we need to delete that object from the nav array
                customBuildNav.splice(sectionIndex, 1)
            } else {
                _.forEach(preBuildSection.items, (customItem) => {
                    // Checking the same route of  exists in customBuildNav
                    // if it exists that will be neglected because more priority to customBuildNav
                    const itemIndex = _.findIndex(
                        customBuildNav[sectionIndex].items,
                        {
                            label: customItem.label,
                        }
                    )
                    if (itemIndex === -1) {
                        customBuildNav[sectionIndex].items.push(customItem)
                    } else {
                        // Checking navItem is hidden or not
                        if (
                            checkSectionIsHidden(
                                customBuildNav[sectionIndex].items,
                                itemIndex
                            )
                        ) {
                            customBuildNav[sectionIndex].items.splice(
                                itemIndex,
                                1
                            )
                        }
                    }
                })
            }
        } else {
            // Section is not exist in custom build nav
            customBuildNav.push(preBuildSection)
        }
    })

    // Finding all content types to list in the contents section
    const contentTypes = await ContentType.find({
        active: true,
        brand: { $in: [req.session.brand?._id] },
    })
        .select(
            '-_id title slug admin_icon admin_nav_section position active single_type has_access'
        )
        .sort([['position', 'ascending']])

    // Looping through all content types and creating navigation
    const listTypeItems = collect(contentTypes)
        .map((item) => {
            if (item.single_type === false) {
                // Non single type content types
                return {
                    section: item.admin_nav_section || 'Content',
                    label: item.title,
                    expandable: true,
                    icon: item.admin_icon,
                    position: item.position,
                    has_access: item.has_access,
                    path: `/admin/cms/${item.slug}`,
                    child: [
                        {
                            label: `All ${item.title}`,
                            path: `/admin/cms/${item.slug}`,
                        },
                        {
                            label: `Add ${item.title}`,
                            path: `/admin/cms/${item.slug}/add`,
                        },
                    ],
                }
            } else {
                // single type content types
                return {
                    section: item.admin_nav_section || 'Content',
                    section_slug: slugify(item.admin_nav_section || 'Content', {
                        lower: true,
                    }),
                    label: item.title,
                    expandable: false,
                    icon: item.admin_icon,
                    has_access: item.has_access,
                    path: `/admin/cms/${item.slug}`,
                }
            }
        })
        .all()

    listTypeItems.forEach((d) => {
        const contentSection = _.find(customBuildNav, { section: d.section })
        if (contentSection) {
            contentSection.items = _.uniqBy(
                _.concat(contentSection.items, d),
                (item) => {
                    return item?.label
                }
            )
        }
    })

    // Sorting all section with their positions
    const mixedNav = _.sortBy(
        customBuildNav.filter((nav) => nav.items?.length),
        'position'
    )

    return mixedNav
}

// Generating the navigation for the cms
const mainNavGenerator = async (req, res, next) => {
    const cacheKey = `${envConfig.cache.CACHE_KEY_PREFIX}-mixed-nav-${req.authUser?.brand?.code}-${req.authUser?.brand?.country_code}`
    const mixedNav = await getCache(cacheKey).then(async (data) => {
        if (!data) {
            const nav = await getNavigation(req)
            await setCache(cacheKey, JSON.stringify(nav), 60 * 60 * 24 * 30)
            return nav
        }
        return JSON.parse(data)
    })

    res.locals.mainNav = mixedNav
    res.locals.activeNav = req.originalUrl
    res.locals.allowedURLs = []
    res.locals.allowedSections = []
    next()
}

const allBrands = async (req, res, next) => {
    const brands = await getBrandsFromCache()
    res.locals.allBrands = brands
    next()
}

const authUser = async (req, res, next) => {
    try {
        if (!req.session.brand) {
            const brand = await getBrand(req, null)
            const domain = brand?.domain

            if (brand && domain?.country) {
                const settings = await getBrandSettings(brand, domain.country)
                req.session.brand = {
                    _id: brand._id,
                    name: brand.name,
                    code: brand.code,
                    languages: brand.languages,
                    country: domain.country._id,
                    country_name: domain.country.name.en,
                    country_code: domain.country.code,
                    country_currency: domain.country.currency,
                    country_currency_symbol: domain.country.currency_symbol,
                    currency_decimal_points:
                        domain.country.currency_decimal_points,
                    country_object: domain.country,
                    settings: settings ? settings : {},
                }
            }
        }
        req.authUser = req.session
        res.locals.authUser = req.session
        next()
    } catch (e) {
        return res.redirect('/admin/auth/login')
    }
}

module.exports = {
    usableLogoUrl,
    baseConfig,
    contentTypeCheck,
    mainNavGenerator,
    allBrands,
    nunjucksFilter,
    authUser,
    getNavigation,
}
