const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required Supabase environment variables', {
    missing: missingEnvVars,
    timestamp: new Date().toISOString()
  });
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Create Supabase client with service role key for full access
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'X-Client-Info': 'meeting-recording-service'
      }
    }
  }
);

/**
 * Test database connection
 */
const testConnection = async () => {
  try {
    const { data, error } = await supabase
      .from('meetings')
      .select('count(*)')
      .limit(1);
    
    if (error) {
      throw error;
    }
    
    logger.info('Database connection successful', {
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    logger.error('Database connection failed', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Database health check
 */
const healthCheck = async () => {
  try {
    const startTime = Date.now();
    
    const { data, error } = await supabase
      .from('service_config')
      .select('key')
      .limit(1);
    
    const responseTime = Date.now() - startTime;
    
    if (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime
      };
    }
    
    return {
      status: 'healthy',
      responseTime,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Get service configuration from database
 */
const getServiceConfig = async (key) => {
  try {
    const { data, error } = await supabase
      .from('service_config')
      .select('value')
      .eq('key', key)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      throw error;
    }
    
    return data.value;
  } catch (error) {
    logger.error(`Failed to get service config for key: ${key}`, {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Update service configuration in database
 */
const updateServiceConfig = async (key, value, description = null) => {
  try {
    const { data, error } = await supabase
      .from('service_config')
      .upsert({
        key,
        value,
        description,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    logger.info(`Service config updated: ${key}`, {
      key,
      timestamp: new Date().toISOString()
    });
    
    return data;
  } catch (error) {
    logger.error(`Failed to update service config for key: ${key}`, {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Execute raw SQL query (for migrations or complex operations)
 */
const executeRawQuery = async (query, params = []) => {
  try {
    const { data, error } = await supabase.rpc('execute_sql', {
      query,
      params
    });
    
    if (error) {
      throw error;
    }
    
    return data;
  } catch (error) {
    logger.error('Raw query execution failed', {
      query: query.substring(0, 100) + '...', // Log first 100 chars
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

// Test connection on module load
testConnection().catch(error => {
  logger.error('Initial database connection test failed', {
    error: error.message,
    timestamp: new Date().toISOString()
  });
});

logger.info('Database configuration initialized', {
  url: process.env.SUPABASE_URL,
  timestamp: new Date().toISOString()
});

module.exports = {
  supabase,
  testConnection,
  healthCheck,
  getServiceConfig,
  updateServiceConfig,
  executeRawQuery
};
