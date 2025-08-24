import { GoogleGenerativeAI } from '@google/generative-ai';

// Multiple API keys for rotation to avoid rate limits
const API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY,
  'AIzaSyAp5APT1c_GHyB99qlqOEnv81LuV5aC0ZA',
  'AIzaSyBGs6lGKZbq9WhuqYH2O9rh6QHWARQMPOQ',
  'AIzaSyDJKTbMMDcyhKsh_tUQn-1b8JlppWVLy9Y',
  'AIzaSyADzQpjE3NTp2N40iSHeDAVMVp9viNZ-UY',
  'AIzaSyBFdKBHOAjdX7-DLrR4-TUlYQBWMZsxCtw',
  'AIzaSyByPzoD-YRoB1QgyKRubUtY_Ssd3AiSbKg',
  'AIzaSyAJvqiF-X1oNLZjOKcreb7di1-BIO9aZAM',
  'AIzaSyA5I_nuPEuWoppGcmGY9Y0_Eq2YGO_ATe8'
].filter(key => key && key.trim() !== '');

if (API_KEYS.length === 0) {
  throw new Error('No valid Gemini API keys found. Please set VITE_GEMINI_API_KEY or provide valid API keys.');
}

let currentKeyIndex = 0;
const keyUsageCount = new Map<string, number>();

function getNextApiKey(): string {
  // Find the key with least usage
  let bestKey = API_KEYS[0];
  let minUsage = keyUsageCount.get(bestKey) || 0;
  
  for (const key of API_KEYS) {
    const usage = keyUsageCount.get(key) || 0;
    if (usage < minUsage) {
      minUsage = usage;
      bestKey = key;
    }
  }
  
  // Increment usage count
  keyUsageCount.set(bestKey, (keyUsageCount.get(bestKey) || 0) + 1);
  
  return bestKey;
}

export interface ExtractedQuestion {
  question_number?: string;
  question_type: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
  question_statement: string;
  options?: string[];
  is_continuation?: boolean;
  page_number: number;
  confidence_score?: number;
  spans_multiple_pages?: boolean;
  continuation_from_page?: number;
  has_image?: boolean;
  image_description?: string;
  uploaded_image?: string; // base64 image data
}

export async function analyzePageForQuestions(
  imageBase64: string,
  pageNumber: number,
  previousContext?: string
): Promise<ExtractedQuestion[]> {
  try {
    const apiKey = getNextApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
You are an expert at extracting questions from exam papers. Analyze this page image and extract ALL questions with perfect accuracy.

CRITICAL REQUIREMENTS:
1. Extract questions EXACTLY as they appear - no modifications, no paraphrasing, but if any obvious error fix that.
2. Preserve all mathematical expressions, formulas, and symbols
3. Convert mathematical content to LaTeX format when possible (use $ for inline math, $$ for display math)
4. Identify question types: MCQ (single correct), MSQ (multiple correct), NAT (numerical answer), Subjective (descriptive)
5. Extract all options exactly as written for MCQ/MSQ questions
6. Handle multi-page questions - if a question seems incomplete, mark it as continuation
7. Preserve all diagrams, figures, and images by describing them in detail they are probably in description
8. Maintain original formatting, spacing, and structure
9. Say if a description if for next few questions then write that description before each of these questions if for 3 questions then write that description with all
10. Write question statement and options saperately not together
11. If a question have three parts then consider them as three parts and instead of next question number write like 11(A), 11(B), 11(C) and so on.
${previousContext ? `PREVIOUS PAGE CONTEXT: ${previousContext}` : ''}

For each question found, provide:
- question_number (if visible)
- question_type (MCQ/MSQ/NAT/Subjective)
- question_statement (exact text with LaTeX for math)
- options (for MCQ/MSQ, exact text with LaTeX)
- is_continuation (true if this continues from previous page)

If this page contains only instructions, headers, or non-question content, return empty array.

Return response as JSON array of questions. Example:
[
  {
    "question_number": "1",
    "question_type": "MCQ",
    "question_statement": "What is the value of $\\int_0^1 x^2 dx$?",
    "options": ["$\\frac{1}{3}$", "$\\frac{1}{2}$", "$1$", "$\\frac{2}{3}$"],
    "is_continuation": false,
    "page_number": ${pageNumber}
  }
]
`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`No questions found on page ${pageNumber}`);
      return [];
    }

    const questions = JSON.parse(jsonMatch[0]) as ExtractedQuestion[];
    return questions.map(q => ({ ...q, page_number: pageNumber }));

  } catch (error) {
    console.error(`Error analyzing page ${pageNumber}:`, error);
    throw new Error(`Failed to analyze page ${pageNumber}: ${error}`);
  }
}

export async function convertPdfToImages(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    // Use PDF.js for better PDF handling
    import('pdfjs-dist').then(async (pdfjsLib) => {
      try {
        // Set worker source
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.js',
          import.meta.url
        ).toString();
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const images: string[] = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 4.0 }); // Ultra high resolution for better OCR
          
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          
          await page.render({
            canvasContext: ctx,
            viewport: viewport
          }).promise;
          
          // Convert to base64
          const imageData = canvas.toDataURL('image/png');
          const base64 = imageData.split(',')[1];
          images.push(base64);
        }
        
        resolve(images);
      } catch (error) {
        reject(error);
      }
    }).catch(reject);
  });
}

export async function enhancedQuestionExtraction(
  images: string[],
  startPageNumber: number = 1
): Promise<ExtractedQuestion[]> {
  const allQuestions: ExtractedQuestion[] = [];
  let sharedDescriptions: Map<number, string> = new Map();
  let multiPageQuestions: Map<string, ExtractedQuestion> = new Map();
  
  // First pass: Analyze all pages to identify shared descriptions and multi-page questions
  for (let i = 0; i < images.length; i++) {
    const pageNum = startPageNumber + i;
    
    try {
      const pageAnalysis = await analyzePageStructure(images[i], pageNum, i > 0 ? images[i-1] : undefined, i < images.length - 1 ? images[i+1] : undefined);
      
      // Store shared descriptions
      if (pageAnalysis.sharedDescription) {
        sharedDescriptions.set(pageNum, pageAnalysis.sharedDescription);
      }
      
      // Add delay between API calls to avoid rate limits
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay with key rotation
      }
      
    } catch (error) {
      console.error(`Error in first pass analysis for page ${pageNum}:`, error);
      // Continue with next page if one fails
    }
  }
  
  // Second pass: Extract questions with full context
  for (let i = 0; i < images.length; i++) {
    const pageNum = startPageNumber + i;
    
    try {
      const questions = await extractQuestionsWithContext(
        images[i], 
        pageNum, 
        sharedDescriptions,
        i > 0 ? images[i-1] : undefined,
        i < images.length - 1 ? images[i+1] : undefined,
        allQuestions
      );
      
      allQuestions.push(...questions);
      
      // 10 second delay for round-robin API key rotation
      if (i < images.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
    } catch (error) {
      console.error(`Error extracting questions from page ${pageNum}:`, error);
      // Try with next API key
      continue;
    }
  }
  
  return allQuestions;
}

async function analyzePageStructure(
  imageBase64: string,
  pageNumber: number,
  previousImage?: string,
  nextImage?: string
): Promise<{
  sharedDescription?: string;
  hasMultiPageQuestion?: boolean;
  questionNumbers?: string[];
}> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 0.8,
        }
      });

      const prompt = `
Analyze this exam page to identify structural elements. Focus on:

1. SHARED DESCRIPTIONS: Look for text like "Description for the following X questions:" or "For questions X-Y:" or "Consider the following for next questions:"
2. MULTI-PAGE QUESTIONS: Identify if any question starts but doesn't complete on this page
3. QUESTION NUMBERS: List all question numbers visible on this page

Return JSON with this structure:
{
  "sharedDescription": "Full text of any shared description found",
  "hasMultiPageQuestion": true/false,
  "questionNumbers": ["17", "18", "19"]
}

If no shared description exists, set sharedDescription to null.
`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/png',
            data: imageBase64
          }
        }
      ]);

      const response = await result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {};
      }

      return JSON.parse(jsonMatch[0]);

    } catch (error: any) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`API key ${retryCount} hit rate limit, trying next key...`);
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('All API keys exhausted for page structure analysis');
}

async function extractQuestionsWithContext(
  imageBase64: string,
  pageNumber: number,
  sharedDescriptions: Map<number, string>,
  previousImage?: string,
  nextImage?: string,
  previousQuestions: ExtractedQuestion[] = []
): Promise<ExtractedQuestion[]> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      const apiKey = getNextApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 0.8,
        }
      });

      // Get shared description for this page
      const currentSharedDescription = sharedDescriptions.get(pageNumber);
      
      // Build context from previous questions
      const recentContext = previousQuestions.slice(-3).map(q => 
        `Q${q.question_number}: ${q.question_statement.substring(0, 200)}...`
      ).join('\n');

      const enhancedPrompt = `
You are an EXPERT question extraction system. Extract ALL questions with ABSOLUTE PRECISION.

CRITICAL EXTRACTION RULES:
1. Extract questions EXACTLY as they appear - preserve every word, symbol, formatting
2. Convert math to LaTeX: $...$ for inline, $$...$$ for display math
3. Handle SHARED DESCRIPTIONS: If there's a description for multiple questions, include it with EACH question
4. Handle MULTI-PAGE QUESTIONS: If a question spans pages, extract the complete question
5. Handle DIAGRAMS/TABLES: Describe them in detail and include in question statement
6. NEVER skip questions with diagrams - describe the diagram thoroughly
7. For incomplete questions, mark as continuation and provide what's visible

SHARED DESCRIPTION HANDLING:
${currentSharedDescription ? `SHARED DESCRIPTION FOR THIS PAGE: "${currentSharedDescription}"` : 'No shared description found'}
- If questions share a description, include the FULL description with EACH question
- Example: If "Description for questions 17-18: [text]" exists, include this description in both Q17 and Q18

DIAGRAM/TABLE HANDLING:
- Describe ALL visual elements: charts, graphs, tables, Venn diagrams, figures
- Include table data in structured format
- For Venn diagrams: describe circles, intersections, labels, shaded regions
- For charts: describe data, axes, percentages, values
- NEVER skip questions because they have diagrams

MULTI-PAGE QUESTION HANDLING:
- If question starts but doesn't end on this page, extract what's visible
- Mark as spans_multiple_pages: true
- If question continues from previous page, mark as is_continuation: true

CONTEXT FROM PREVIOUS QUESTIONS:
${recentContext}

RESPONSE FORMAT - ENSURE PROPER JSON ESCAPING:
[
  {
    "question_number": "17",
    "question_type": "MCQ",
    "question_statement": "FULL shared description + question statement + diagram description",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "shared_description": "Full shared description text",
    "has_diagram": true,
    "diagram_description": "Detailed description of diagram/table",
    "table_content": "Structured table data if present",
    "spans_multiple_pages": false,
    "is_continuation": false,
    "page_number": ${pageNumber}
  }
]

CRITICAL: Use double backslashes (\\\\) for ALL LaTeX commands in JSON.
CRITICAL: Include shared descriptions with EVERY question that uses them.
CRITICAL: NEVER skip questions with diagrams - describe them thoroughly.
`;

      const result = await model.generateContent([
        enhancedPrompt,
        {
          inlineData: {
            mimeType: 'image/png',
            data: imageBase64
          }
        }
      ]);

      const response = await result.response;
      const text = response.text();
      
      // Enhanced JSON extraction with better error handling
      let jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          jsonMatch = [codeBlockMatch[1]];
        }
      }
      
      if (!jsonMatch) {
        console.log(`No valid JSON found on page ${pageNumber}`);
        return [];
      }

      try {
        const questions = JSON.parse(jsonMatch[0]) as ExtractedQuestion[];
        return questions.map(q => ({ 
          ...q, 
          page_number: pageNumber,
          confidence_score: q.confidence_score || 1.0
        }));
      } catch (parseError) {
        console.error(`JSON parsing error on page ${pageNumber}:`, parseError);
        
        // Enhanced JSON fixing
        try {
          let fixedJson = jsonMatch[0];
          
          // Fix LaTeX escaping issues
          fixedJson = fixedJson
            .replace(/\\(?![\\"])/g, '\\\\')  // Escape single backslashes
            .replace(/\\\\\\\\+/g, '\\\\\\\\') // Fix over-escaped backslashes
            .replace(/\n/g, '\\n')            // Escape newlines
            .replace(/\t/g, '\\t')            // Escape tabs
            .replace(/\r/g, '\\r');           // Escape carriage returns
          
          const questions = JSON.parse(fixedJson) as ExtractedQuestion[];
          return questions.map(q => ({ 
            ...q, 
            page_number: pageNumber,
            confidence_score: q.confidence_score || 1.0
          }));
        } catch (secondParseError) {
          console.error(`JSON parsing failed twice on page ${pageNumber}:`, secondParseError);
          return [];
        }
      }

    } catch (error: any) {
      retryCount++;
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`API key ${retryCount} hit rate limit, trying next key...`);
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      throw error;
    }
  }
  
  throw new Error('All API keys exhausted for question extraction');
}

export async function performExtraction(
  imageBase64: string,
  pageNumber: number,
  previousContext: string = '',
  pageMemory: Map<number, string> = new Map()
): Promise<ExtractedQuestion[]> {
  const maxRetries = API_KEYS.length;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
    const apiKey = getNextApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.1,
        topK: 1,
        topP: 0.8,
      }
    });

    // Build memory context from previous pages
    const memoryContext = Array.from(pageMemory.entries())
      .slice(-3) // Keep last 3 pages in memory
      .map(([page, content]) => `Page ${page}: ${content.substring(0, 500)}...`)
      .join('\n\n');

    const enhancedPrompt = `
You are an EXPERT question extraction system for competitive exam papers. Extract ONLY actual questions with ABSOLUTE PRECISION.

MULTI-PAGE QUESTION HANDLING:
- CRITICAL: Some questions span multiple pages with long descriptions or multiple parts
- If you see an incomplete question (starts but doesn't end), mark it as spans_multiple_pages: true
- If you see a continuation of a question from previous page, mark it as is_continuation: true
- COMBINE multi-page questions into ONE complete question with full content
- For questions with parts (a, b, c), treat each part as a separate question with shared description

MEMORY CONTEXT FROM PREVIOUS PAGES:
${memoryContext}

PREVIOUS PAGE CONTEXT: ${previousContext}

CRITICAL RULES:
1. IGNORE general instructions, exam rules, or non-question content
2. Extract ONLY numbered questions (1, 2, 3, etc.) or lettered questions (a, b, c, etc.)
3. Include shared descriptions DIRECTLY in question_statement for each applicable question
4. Include diagram/table descriptions DIRECTLY in question_statement (don't separate them)
5. Convert math to LaTeX: use $ for inline math, $$ for display math
6. Question types: MCQ (single answer), MSQ (multiple answers), NAT (numerical), Subjective (descriptive)
7. For JSON: Use double backslashes (\\\\) for LaTeX commands, escape quotes as \\"
8. HANDLE IMAGES: If question has diagrams/images that cannot be described in text, mark has_image: true and provide detailed description

WHAT TO EXTRACT:
- Questions with numbers like "17.", "18.", "Q17", "Question 17"
- Include complete shared descriptions in each question's statement
- Include complete diagram/table descriptions in question statement
- Include all visual elements as text descriptions
- For multi-part questions (17a, 17b, 17c), create separate questions with shared description

WHAT TO IGNORE:
- General exam instructions
- Page headers/footers
- Non-question text
- Instructions that don't relate to specific questions

JSON FORMAT REQUIREMENTS:
- Use \\\\ for all LaTeX backslashes
- Escape quotes as \\"
- No line breaks in strings (use \\n if needed)
- Keep JSON simple and clean

RESPONSE FORMAT (CLEAN JSON ONLY):
[
  {
    "question_number": "17",
    "question_type": "MCQ",
    "question_statement": "Complete shared description + question statement + diagram/table descriptions all combined",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "is_continuation": false,
    "spans_multiple_pages": false,
    "has_image": false,
    "image_description": "Detailed description of any visual elements",
    "page_number": ${pageNumber}
  }
]

CRITICAL: Return ONLY valid JSON. No extra text, no explanations, just the JSON array.
`;

    const result = await model.generateContent([
      enhancedPrompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();
    
    // Store this page's content in memory for future pages
    pageMemory.set(pageNumber, text.substring(0, 1000));
    
    // Enhanced JSON extraction
    let jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonMatch = [codeBlockMatch[1]];
      }
    }
    
    if (!jsonMatch) {
      console.log(`No valid JSON found on page ${pageNumber}`);
      return [];
    }

    try {
      const questions = JSON.parse(jsonMatch[0]) as ExtractedQuestion[];
      return questions.map(q => ({ 
        ...q, 
        page_number: pageNumber,
        confidence_score: q.confidence_score || 1.0
      }));
    } catch (parseError) {
      console.error(`JSON parsing error on page ${pageNumber}:`, parseError);
      return [];
    }

    } catch (error: any) {
      retryCount++;
      console.error(`Error with API key ${retryCount} for page ${pageNumber}:`, error);
      
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        console.log(`API key ${retryCount} hit rate limit for page ${pageNumber}, trying next key...`);
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      
      if (retryCount >= maxRetries) {
        throw new Error(`All ${maxRetries} API keys exhausted for page ${pageNumber}: ${error.message}`);
      }
    }
  }
  
  throw new Error(`Failed to process page ${pageNumber} after trying all API keys`);
}