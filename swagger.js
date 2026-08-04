const swaggerJsdoc = require("swagger-jsdoc");

const options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Projet tutoré",
            version: "1.2.0",
            description: "La documentation de mon api rest pour le projet tutoré" 
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