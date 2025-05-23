import { Response } from 'express';
import pdfParse from 'pdf-parse';
import { generateEmbeddings } from '../lib/embeddings.js';
import { splitDocument, getContentType } from '../lib/splitter.js';
// import {bulkSaveEmbeddings, bulkSaveDataSources } from '../lib/db.js';
import { bulkSaveEmbeddingsAndDataSources } from '../lib/db.js';
import { ProcessRequestBody } from '../lib/types.js';
import multer from 'multer';
import { Request } from 'express';
import { processMultipleCSVs } from '../lib/special-csv.js';
import { improveChunks } from '../lib/embeddings.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

async function readFileContent(file: Express.Multer.File): Promise<string> {
  const contentType = getContentType(file.originalname);

  if (contentType === 'application/pdf') {
    // pdf-parse expects a Buffer directly
    const pdfData = await pdfParse(file.buffer);
    return pdfData.text;
  }

  // For text files
  return file.buffer.toString('utf-8');
}


export const processHandler = [
  upload.fields([{ name: 'documents' }, { name: 'csvFiles' }]),
  async (req: Request, res: Response) => {
    try {
      const userID = req.body.userId;
      const chatbotID = req.body.chatbotID;
      const websiteURL = JSON.parse(req.body.websiteURL || '[]');
      const qandaData = JSON.parse(req.body.qandaData || '[]');
      const documents = (req.files?.['documents'] as Express.Multer.File[] || []);
      const csvFiles = (req.files?.['csvFiles'] as Express.Multer.File[] || []);

      console.log('Received data:', {
        chatbotID,
        websiteURL,
        qandaData,
        documents: documents.map(f => f.originalname),
        csvFiles: csvFiles.map(f => f.originalname)
      });

      const chatbotId = parseInt(chatbotID);
      
      let allChunks: { text: string; source: string }[] = [];
      // Build an array of data sources to be saved with the new top‑level citation field.
      let dataSourcesToSave: {
        type: string;
        name: string;
        sourceDetails: any;
        citation: string;
      }[] = [];

      // Process documents in parallel
      const documentPromises = documents.map(async (file) => {
        const content = await readFileContent(file);
        const chunks = await splitDocument(content, 'semantic', {
          source: file.originalname,
          type: 'document',
        });

        // For documents, use the file name for citation.
        dataSourcesToSave.push({
          type: 'Document',
          name: file.originalname,
          sourceDetails: { type: getContentType(file.originalname) },
          citation: file.originalname,
        });

        const improvedChunksResult = await improveChunks(chunks.map(chunk => chunk.text));
        return improvedChunksResult.map(chunk => ({
          text: chunk,
          source: file.originalname,  // will match the data source by name
        }));
      });

      // Process websites in parallel
      const websitePromises = websiteURL.map(async (url) => {
        const response = await fetch(`${process.env.CRAWL_API_URL}/crawl`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: [url] }),
        });
        if (!response.ok) {
          throw new Error('Failed to fetch website content');
        }
        const content = await response.json();
        const chunks = await splitDocument(content[0], 'semantic', {
          source: url,
          type: 'website',
        });

        dataSourcesToSave.push({
          type: 'Website',
          name: url,
          sourceDetails: { url },
          citation: url,
        });

        const improvedChunksResult = await improveChunks(chunks.map(chunk => chunk.text));
        return improvedChunksResult.map(chunk => ({
          text: chunk,
          source: url,
        }));
      });

      // Process Q&A pairs (manual input)
      const qnaPromises = qandaData.map((qa) => {
        // For Q&A, use the question as the citation for each pair.
        dataSourcesToSave.push({
          type: 'QandA',
          name: 'Q&A Pairs',
          sourceDetails: { questions: qandaData.map((qa: any) => qa.question) },
          citation: qa.question,
        });

        return {
          text: `Question: ${qa.question}\nAnswer: ${qa.answer}`,
          source: qa.question,  // Note: this source field might not match a data source name.
        };
      });

      // Process CSV files in parallel
      const csvPromises = csvFiles.map(async (csvFile) => {
        const qnaPairs = await processMultipleCSVs([csvFile]);
        dataSourcesToSave.push({
          type: 'QandA',
          name: csvFile.originalname,
          sourceDetails: { questions: qnaPairs.map(qna => qna.question) },
          citation: csvFile.originalname,
        });

        return qnaPairs.map(qna => ({
          text: `${qna.question}\n${qna.answer}`,
          source: csvFile.originalname, // Use CSV filename as the source
        }));
      });

      // Wait for all promises to complete and flatten the results
      allChunks = [
        ...(await Promise.all(documentPromises)).flat(),
        ...(await Promise.all(websitePromises)).flat(),
        ...qnaPromises,
        ...(await Promise.all(csvPromises)).flat(),
      ];

      if (allChunks.length > 0) {
        const texts = allChunks.map(chunk => chunk.text);
        const embeddings = await generateEmbeddings(texts);

        // Prepare embeddingsData: each chunk uses the matching DataSource name as topic.
        const embeddingsData = allChunks.map((chunk, i) => ({
          userId: Number(userID),
          chatbotId,
          topic: dataSourcesToSave.find(ds => ds.name === chunk.source)?.name || chunk.source,
          text: chunk.text,
          embedding: embeddings[i],
        }));

        // Prepare dataSourcesData: include the new citation field.
        const dataSourcesData = dataSourcesToSave.map(source => ({
          chatbotId,
          type: source.type as "Website" | "QandA" | "Document" | "CSV",
          name: source.name,
          sourceDetails: source.sourceDetails,
          citation: source.citation,
        }));

        // Perform bulk inserts in parallel using the updated function.
        await bulkSaveEmbeddingsAndDataSources(embeddingsData, dataSourcesData);

        return res.status(200).json({ status: 'success' });
      } else {
        return res.status(400).json({ error: 'No content to process' });
      }
    } catch (error) {
      console.error('Error in process handler:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
];



// export const processHandler = [
//   upload.fields([{ name: 'documents' }, { name: 'CSV' }]),
//   async (req: Request, res: Response) => {
//     try {
//       const userID = req.body.userId;
//       const chatbotID = req.body.chatbotID;
//       const websiteURL = JSON.parse(req.body.websiteURL || '[]');
//       const qandaData = JSON.parse(req.body.qandaData || '[]');
//       const documents = (req.files?.['documents'] as Express.Multer.File[] || []);
//       const csvFiles = (req.files?.['csvFiles'] as Express.Multer.File[] || []);

//       console.log('Received data:', {
//         chatbotID,
//         websiteURL,
//         qandaData,
//         documents: documents.map(f => f.originalname),
//         csvFiles: csvFiles.map(f => f.originalname)
//       });

//       const chatbotId = parseInt(chatbotID);
      
//       let allChunks: { text: string; source: string }[] = [];
//       let dataSourcesToSave: { type: string; name: string; sourceDetails: any }[] = [];

//       // Process documents
//       if (documents.length > 0) {
//         for (const file of documents) {
//           const content = await readFileContent(file);
//           const chunks = await splitDocument(content, 'semantic', {
//             source: file.originalname,
//             type: 'document'
//           });
          
//           allChunks.push(...chunks.map(chunk => ({
//             text: chunk.text,
//             source: file.originalname
//           })));
          
//           dataSourcesToSave.push({
//             type: 'Document',
//             name: file.originalname,
//             sourceDetails: { type: getContentType(file.originalname) }
//           });
//         }
//       }

//       // Process websites
//       if (websiteURL.length > 0) {
//         const response = await fetch(`${process.env.CRAWL_API_URL}/crawl`, {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/json' },
//           body: JSON.stringify({ urls: websiteURL })
//         });

//         if (!response.ok) {
//           throw new Error('Failed to fetch website content');
//         }

//         const contents = await response.json();
        
//         for (let i = 0; i < websiteURL.length; i++) {
//           const chunks = await splitDocument(contents[i], 'semantic', {
//             source: websiteURL[i],
//             type: 'website'
//           });
//           allChunks.push(...chunks.map(chunk => ({
//             text: chunk.text,
//             source: websiteURL[i]
//           })));
          
//           dataSourcesToSave.push({
//             type: 'Website',
//             name: websiteURL[i],
//             sourceDetails: { url: websiteURL[i] }
//           });
//         }
//       }

//       // Process Q&A pairs
//       if (qandaData.length > 0) {
//         const qandaTexts = qandaData.map(
//           qa => `Question: ${qa.question}\nAnswer: ${qa.answer}`
//         );
//         allChunks.push(...qandaTexts.map((text, i) => ({
//           text,
//           source: qandaData[i].question
//         })));
        
//         dataSourcesToSave.push({
//           type: 'QandA',
//           name: 'Q&A Pairs',
//           sourceDetails: { question: qandaData.map((qa: { question: string }) => qa.question) }
//         });
//       }

//       // Process CSV files
//       if (csvFiles.length > 0) {
//         const qnaPairs = await processMultipleCSVs(csvFiles);
//         allChunks.push(...qnaPairs.map(qna => ({
//           text: `${qna.question}\n${qna.answer}`,
//           source: qna.question
//         })));

//         dataSourcesToSave.push({
//           type: 'QandA',
//           name: 'Q&A Pairs',
//           sourceDetails: { question: qnaPairs.map(qna => qna.question) }
//         });
//       }

//       // Generate embeddings for all chunks in one go
//       if (allChunks.length > 0) {
//         const texts = allChunks.map(chunk => chunk.text);
//         const embeddings = await generateEmbeddings(texts);

//         // Prepare data for bulk insert
//         const embeddingsData = allChunks.map((chunk, i) => ({
//           userId : userID,
//           chatbotId,
//           topic: chunk.source,
//           text: chunk.text,
//           embedding: embeddings[i]
//         }));

//         // Prepare data sources for bulk insert
//         const dataSourcesData = dataSourcesToSave.map(source => ({
//           chatbotId,
//           type: source.type as "Website" | "QandA" | "Document" | "CSV",
//           name: source.name,
//           sourceDetails: source.sourceDetails
//         }));

//         // Perform bulk inserts
//         await bulkSaveEmbeddings(embeddingsData);
//         await bulkSaveDataSources(dataSourcesData);
        
//         return res.status(200).json({ status: 'success' });
//       }
//     } catch (error) {
//       console.error('Error in process handler:', error);
//       return res.status(500).json({ error: 'Internal server error' });
//     }
//   }
// ]; 