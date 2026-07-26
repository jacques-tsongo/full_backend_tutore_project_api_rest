const swaggerJsdoc = require("swagger-jsdoc");

const options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Tutore API",
            version: "1.0.0",
            description: "Documentation de l'API"
        },
        servers: [
            {
                url: "http://localhost:3000/api"
            }
        ]
    },

    apis: [
        "./src/routes/*.js"
    ]
};

module.exports = swaggerJsdoc(options);