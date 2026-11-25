import { defineUnlighthouseConfig } from 'unlighthouse/config'

export default defineUnlighthouseConfig({
    site: 'http://localhost:3000/',
    scanner: {
        samples: 3, // Run each page 3x and average (more accurate)
        throttle: true, // Simulate real network conditions
        exclude: ['/admin/*', '/api/*'], // Skip these paths
    },
})