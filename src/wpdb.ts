import {createConnection} from './database'
import * as settings from './settings'
import {decodeHTML} from 'entities'

const wpdb = createConnection({
    database: settings.WORDPRESS_DB_NAME as string
})

export async function query(queryStr: string, params?: any[]): Promise<any[]> {
    return wpdb.query(queryStr, params)
}

export function end() {
    wpdb.end()
}

// Retrieve a map of post ids to authors
let cachedAuthorship: Map<number, string[]>
export async function getAuthorship(): Promise<Map<number, string[]>> {
    if (cachedAuthorship) return cachedAuthorship

    const authorRows = await wpdb.query(`
        SELECT object_id, terms.description FROM wp_term_relationships AS rels
        LEFT JOIN wp_term_taxonomy AS terms ON terms.term_taxonomy_id=rels.term_taxonomy_id 
        WHERE terms.taxonomy='author'
    `)

    const authorship = new Map<number, string[]>()
    for (const row of authorRows) {
        let authors = authorship.get(row.object_id)
        if (!authors) {
            authors = []
            authorship.set(row.object_id, authors)
        }
        authors.push(row.description.split(" ").slice(0, 2).join(" "))
    }

    cachedAuthorship = authorship
    return authorship
}

export interface CategoryWithEntries {
    name: string,
    entries: {
        slug: string,
        title: string,
        starred: boolean
    }[]
}

// Retrieve a list of categories and their associated entries
let cachedEntries: CategoryWithEntries[]
export async function getEntriesByCategory(): Promise<CategoryWithEntries[]> {
    if (cachedEntries) return cachedEntries

    const categoryOrder = [
        "Population",
        "Health",
        "Food" ,
        "Energy",
        "Environment",
        "Technology",
        "Growth &amp; Inequality",
        "Work &amp; Life",
        "Public Sector",
        "Global Connections",
        "War &amp; Peace",
        "Politics" ,
        "Violence &amp; Rights",
        "Education",
        "Media",
        "Culture"
    ]

    const categoriesByPageId = new Map<number, string[]>()
    const rows = await wpdb.query(`
        SELECT object_id, terms.name FROM wp_term_relationships AS rels
        LEFT JOIN wp_terms AS terms ON terms.term_id=rels.term_taxonomy_id
    `)

    for (const row of rows) {
        let cats = categoriesByPageId.get(row.object_id)
        if (!cats) {
            cats = []
            categoriesByPageId.set(row.object_id, cats)
        }
        cats.push(row.name)
    }

    const pageRows = await wpdb.query(`
        SELECT posts.ID, post_title, post_date, post_name, perma.meta_value AS custom_permalink, star.meta_value AS starred FROM wp_posts AS posts
        LEFT JOIN wp_postmeta AS perma ON perma.post_id=ID AND perma.meta_key='custom_permalink'
        LEFT JOIN wp_postmeta AS star ON star.post_id=ID AND star.meta_key='_ino_star'
        WHERE posts.post_type='page' AND posts.post_status='publish' ORDER BY posts.menu_order ASC
    `)

    cachedEntries = categoryOrder.map(cat => {
        const rows = pageRows.filter(row => {
            const cats = categoriesByPageId.get(row.ID)
            return cats && cats.indexOf(cat) !== -1
        })
        
        const entries = rows.map(row => {
            return {
                slug: row.custom_permalink||row.post_name,
                title: row.post_title,
                starred: row.starred == "1"
            }
        })

        return {
            name: decodeHTML(cat),
            entries: entries
        }
    })

    return cachedEntries
}

let cachedPermalinks: Map<number, string>
export async function getCustomPermalinks() {
    if (cachedPermalinks) return cachedPermalinks

    const rows = await wpdb.query(`SELECT post_id, meta_value FROM wp_postmeta WHERE meta_key='custom_permalink'`)
    const permalinks = new Map<number, string>()
    for (const row of rows) {
        permalinks.set(row.post_id, row.meta_value)
    }

    cachedPermalinks = permalinks
    return permalinks
}    

let cachedFeaturedImages: Map<number, string>
export async function getFeaturedImages() {
    if (cachedFeaturedImages)
        return cachedFeaturedImages

    const rows = await wpdb.query(`SELECT wp_postmeta.post_id, wp_posts.guid FROM wp_postmeta INNER JOIN wp_posts ON wp_posts.ID=wp_postmeta.meta_value WHERE wp_postmeta.meta_key='_thumbnail_id'`)

    const featuredImages = new Map<number, string>()
    for (const row of rows) {
        featuredImages.set(row.post_id, row.guid)
    }

    cachedFeaturedImages = featuredImages
    return featuredImages
}

export interface FullPost {
    id: number
    slug: string
    title: string
    date: Date
    authors: string[]
    content: string
    excerpt?: string
    imageUrl?: string
}

export async function getFullPost(row: any): Promise<FullPost> {
    const authorship = await getAuthorship()
    const featuredImages = await getFeaturedImages()
    const permalinks = await getCustomPermalinks()

    return {
        id: row.ID,
        slug: permalinks.get(row.ID) || row.post_name,
        title: row.post_title,
        date: new Date(row.post_date),
        authors: authorship.get(row.ID) || [],
        content: row.post_content,
        excerpt: row.post_excerpt,
        imageUrl: featuredImages.get(row.ID)
    }
}