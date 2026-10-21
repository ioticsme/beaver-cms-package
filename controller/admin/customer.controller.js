const { logError } = require('../../helper/Logger.helper')
const User = require('../../model/User') // Import the User model for database operations
const AjaxPaginationCustomerResource = require('../../resources/api/ajaxPaginationCustomer.resource') // Import the resource for handling AJAX pagination


// Function to render the customer listing page
const list = async (req, res) => {
    try {
        // Render the customer listing page using AJAX for dynamic data loading
        res.render(`admin-njk/ecommerce/customers/listing-ajax`)
    } catch (error) {
        logError(error)
        // If an error occurs, render a generic error page
        return res.render(`admin-njk/app-error-500`)
    }
}

// Function to handle fetching customers with AJAX pagination
const customers = async (req, res) => {
    try {
        const session = req.authUser // Store the authenticated user session

        // Extract pagination and sorting parameters from the request query
        let { draw, start, length } = req.query
        let page = start / length + 1 || 1 // Calculate the current page
        let limit = req.query.length ? req.query.length : 25 // Set the limit for items per page

        let columns = req.query.columns // Get the columns from the request
        let sortColumn = req.query.order?.[0]?.column // Determine which column to sort by
        let sortDirection = req.query.order?.[0]?.dir // Determine sort direction (asc or desc)
        let selectedColumn = columns?.at(sortColumn) // Get the selected column object for sorting
        let sortOrder = {
            [selectedColumn?.data]: sortDirection == 'desc' ? -1 : 1, // Prepare the sort order for the query
        }

        // Pagination options for the database query
        const options = {
            page,
            limit,
            sort: sortOrder,
        }

        // Initialize the query object for filtering results
        let query = {
            deleted: { $ne: true },
        }
        // If a search term is provided, modify the query to search by first name
        if (req.query?.search?.value) {
            query = {
                ...query,
                first_name: {
                    $regex: `.*${req.query?.search?.value?.toLowerCase()}.*`, // Use regex for case-insensitive search
                    $options: 'i', // Enable case-insensitivity in the regex search
                },
            }
        }

        // Fetch the total count of customers matching the query
        const customersCount = await User.find(query).count()
        // Fetch the customers with pagination applied
        const customers = await User.paginate(query, options)

        // Prepare the response object for AJAX
        customers.draw = draw // Add the draw parameter for DataTables
        customers.totalItems = customersCount // Add total count of items

        // Return the formatted customer data as JSON
        return res
            .status(200)
            .json(new AjaxPaginationCustomerResource(customers).exec())
    } catch (error) {
        logError(error)
        // Return a generic error response
        return res.status(500).json({ error: 'Something went wrong' })
    }
}

// Function to render the details of a specific customer
const detail = async (req, res) => {
    try {
        // Find the user by ID and populate their associated cards
        const user = await User.findOne({
            _id: req.params.id,
            deleted: { $ne: true },
        }).populate('cards')
        // Render the user detail page
        res.render(`admin-njk/ecommerce/customers/details`, { user })
    } catch (error) {
        logError(error)
        // If an error occurs, render a generic error page
        return res.render(`admin-njk/app-error-500`)
    }
}

// Function to toggle the active status of a user
const activateUser = async (req, res) => {
    try {
        // Find the user by ID
        const user = await User.findOne({
            _id: req.params.id,
            deleted: { $ne: true },
        })
        user.active = !user.active // Toggle the active status
        await user.save() // Save the updated user status
        // Redirect back to the customer listing page
        res.redirect(`/admin/ecommerce/customers`)
    } catch (error) {
        logError(error)
        // If an error occurs, render a generic error page
        return res.render(`admin-njk/app-error-500`)
    }
}

// Export the functions for use in other modules
module.exports = {
    list,
    customers,
    detail,
    activateUser,
}
