import google.generativeai as genai
import os
import time
import dotenv
import psycopg2
from psycopg2.extras import execute_values
from splitter import get_text_splitter
from gemini_embedder import clean_text
dotenv.load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")

genai.configure(api_key=GEMINI_API_KEY)

# Connect to PostgreSQL
def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

# Function to get embeddings from Gemini model
def get_embeddings_from_gemini(texts):
    embeddings = []
    for text in texts:
        response = genai.embed_content(
            model="models/text-embedding-004",
            content=text
        )
        embedding = response['embedding']
        # Ensure the embedding has the correct dimension
        # embedding = adjust_embedding_dimension(embedding, 1024)
        embeddings.append(embedding)
    return embeddings

# Function to store embeddings in PostgreSQL
def store_embeddings_in_postgres(chatbotID, userId, topic, texts, embeddings):
    # SQL query for bulk insertion
    insert_query = """
    INSERT INTO "embeddings" ("chatbotid", "userId", "topic", "text", "embedding", "createdAt", "updatedAt")
    VALUES %s
    """
    
    # Prepare data for insertion
    records = [
        (chatbotID, userId, topic, text, embedding, time.strftime('%Y-%m-%d %H:%M:%S'), time.strftime('%Y-%m-%d %H:%M:%S'))
        for text, embedding in zip(texts, embeddings)
    ]
    
    # Insert data into PostgreSQL
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            execute_values(cursor, insert_query, records, template=None, page_size=100)
        conn.commit()
    except Exception as e:
        print("Failed to insert embeddings:", e)
        conn.rollback()
    finally:
        conn.close()


async def embed(content, chatbotID, userId, topic, content_type="text/plain"):
    try:
        print(f"Embedding content of type: {content_type}")
        print(f"Content length: {len(content) if content else 0}")
        
        # For Q&A, directly store without chunking
        if content_type == "qa":
            chunks = [content]
        else:
            # Get the appropriate splitter and split the content
            chunks = get_text_splitter(content_type, content)
        
        print(f"Generated {len(chunks)} chunks")

        cleaned_chunks = clean_text(chunks)
        
        # Generate embeddings
        embeddings = get_embeddings_from_gemini(cleaned_chunks)
        
        return {
            'chunks': cleaned_chunks,
            'embeddings': embeddings,
            'topic': topic
        }
    except Exception as e:
        print(f"Error in embed function: {str(e)}")
        raise

# New function for batch storage
def batch_store_embeddings(chatbotID, userId, embedding_data_list):
    """
    Store multiple sets of embeddings in a single database transaction
    """
    # SQL query for bulk insertion
    insert_query = """
    INSERT INTO "embeddings" ("chatbotid", "userId", "topic", "text", "embedding", "createdAt", "updatedAt")
    VALUES %s
    """
    
    # Prepare all records for insertion
    current_time = time.strftime('%Y-%m-%d %H:%M:%S')
    records = []
    
    for data in embedding_data_list:
        chunks = data['chunks']
        embeddings = data['embeddings']
        topic = data['topic']
        
        records.extend([
            (chatbotID, userId, topic, text, embedding, current_time, current_time)
            for text, embedding in zip(chunks, embeddings)
        ])
    
    # Insert all data in a single transaction
    try:
        conn = get_db_connection()
        with conn.cursor() as cursor:
            execute_values(cursor, insert_query, records, template=None, page_size=100)
        conn.commit()
        print(f"Successfully stored {len(records)} embeddings in database")
    except Exception as e:
        print("Failed to insert embeddings:", e)
        conn.rollback()
        raise e
    finally:
        conn.close()
