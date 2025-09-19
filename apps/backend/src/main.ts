// main.ts
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';


// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env['PORT'] || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from public directory

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env['OPENAI_API_KEY'], // Make sure to set this in your .env file
});

// Types
interface BookRecommendation {
    title: string;
    author: string;
    reason: string;
    genre: string;
}

interface RecommendationRequest {
    books: string[];
}

interface RecommendationResponse {
    inputBooks: string[];
    recommendations: BookRecommendation[];
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Book recommendation server is running!' });
});
app.get('/api/test-openai', async (req, res) => {
    try {
        console.log('🧪 Testing OpenAI connection...');
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: "Say hello" }],
            max_tokens: 10
        });
        
        res.json({ 
            success: true, 
            message: 'OpenAI connection successful',
            response: response.choices[0].message.content
        });
    } catch (error) {
        console.error('❌ OpenAI test failed:', error);
        res.status(500).json({ 
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});


// Book suggestions endpoint using OpenAI for autocomplete
app.get('/api/book-suggestions', async (req, res) => {
    try {
        const query = (req.query.q as string) || '';
        
        if (query.length < 2) {
            return res.json([]);
        }
        
        const prompt = `Given the partial book title or author "${query}", suggest 8 real book titles that start with or contain these characters. Only return book titles, one per line, no numbering or extra text.`;
        
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are a book database. Return only book titles, one per line."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 200,
            temperature: 0.3
        });
        
        const suggestions = completion.choices[0].message.content
            ?.split('\n')
            .filter(book => book.trim().length > 0)
            .slice(0, 8) || [];
        
        res.json(suggestions);
    } catch (error) {
        console.error('Error fetching book suggestions:', error);
        res.status(500).json({ error: 'Failed to fetch book suggestions' });
    }
});

// Main book recommendation endpoint
app.post('/api/recommend-books', async (req, res) => {
    console.log("Incoming body:", req.body);
    try {
        const { books }: RecommendationRequest = req.body;
        
        if (!books || !Array.isArray(books) || books.length === 0) {
            return res.status(400).json({ 
                error: 'Please provide at least one book in the books array' 
            });
        }
        
        if (books.length > 10) {
            return res.status(400).json({ 
                error: 'Please provide no more than 10 books for better recommendations' 
            });
        }
        
        // Create the prompt for OpenAI
        const bookList = books.join(', ');
        const prompt = `Based on someone who enjoyed reading these books: ${bookList}

Please recommend 5 books that this person would likely enjoy. For each recommendation, provide:
1. Book title
2. Author
3. A brief explanation (2-3 sentences) of why this book would appeal to someone who liked the given books
4. Genre/category

Format your response as a JSON object with this structure:
{
  "recommendations": [
    { "title": "...", "author": "...", "reason": "...", "genre": "..." }
  ]
}
Make sure the recommendations are diverse but still aligned with the reader's apparent taste. Consider themes, writing styles, genres, and complexity levels that match the input books.`;

        // Call OpenAI API
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are a knowledgeable book recommendation expert. Respond ONLY with valid JSON, no extra text"
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 1500,
            temperature: 0.7,
            response_format: { type: "json_object" } 
        });

        const recommendationsText = completion.choices[0].message.content || '';
        
        // Try to parse as JSON, if it fails, format the text response
        // Parse JSON
let recommendations: BookRecommendation[] = [];

try {
    const parsed = JSON.parse(recommendationsText);

    if (Array.isArray(parsed.recommendations)) {
        recommendations = parsed.recommendations;
    } else if (Array.isArray(parsed)) {
        // fallback: raw array
        recommendations = parsed;
    } else {
        console.log('Invalid recommendations format:', parsed);
        throw new Error('Invalid response format from OpenAI');
    }
} catch (parseError) {
    console.log('JSON parsing failed, attempting text parsing...');
    recommendations = parseTextRecommendations(recommendationsText);
}
const response: RecommendationResponse = {
            inputBooks: books,
            recommendations: recommendations.slice(0, 5) // max 5 recommendations
        };

        res.json(response); // <-- this is the correct place

    } catch (error) {
        console.error('Error getting book recommendations:', error);
        res.status(500).json({ 
            error: 'Failed to get book recommendations. Please try again.' 
        });
    }

});

// Helper function to parse text recommendations if JSON parsing fails
function parseTextRecommendations(text: string): BookRecommendation[] {
    const recommendations: BookRecommendation[] = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    let currentBook: Partial<BookRecommendation> = {};
    for (const line of lines) {
        const lowerLine = line.toLowerCase();
        
        if (lowerLine.includes('title:') || lowerLine.match(/^\d+\./)) {
            if (currentBook.title) {
                recommendations.push(currentBook as BookRecommendation);
                currentBook = {};
            }
            currentBook.title = line.replace(/^\d+\.|\btitle:\s*/i, '').trim();
        } else if (lowerLine.includes('author:')) {
            currentBook.author = line.replace(/author:\s*/i, '').trim();
        } else if (lowerLine.includes('reason:') || lowerLine.includes('why:')) {
            currentBook.reason = line.replace(/reason:\s*|why:\s*/i, '').trim();
        } else if (lowerLine.includes('genre:')) {
            currentBook.genre = line.replace(/genre:\s*/i, '').trim();
        }
    }
    
    if (currentBook.title) {
        recommendations.push(currentBook as BookRecommendation);
    }
    
    return recommendations;
}

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`📚 Book recommendation server running on port ${PORT}`);
    console.log(`🚀 API endpoints:`);
    console.log(`   GET  /api/health - Health check`);
    console.log(`   GET  /api/book-suggestions?q=query - Get book suggestions`);
    console.log(`   POST /api/recommend-books - Get book recommendations`);
    console.log(`💡 Make sure to set OPENAI_API_KEY in your .env file`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT received, shutting down gracefully');
    process.exit(0);
});