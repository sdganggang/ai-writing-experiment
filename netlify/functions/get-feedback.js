const axios = require('axios');
const jwt = require('jsonwebtoken'); // We need this library to generate a token for Zhipu AI

// Function to generate the API token for Zhipu AI
function generateToken(apiKey, expSeconds) {
    const [id, secret] = apiKey.split('.');
    const payload = {
        api_key: id,
        exp: Math.floor(Date.now() / 1000) + expSeconds,
        timestamp: Math.floor(Date.now() / 1000),
    };
    return jwt.sign(payload, secret, { algorithm: 'HS256', header: { alg: 'HS256', sign_type: 'SIGN' } });
}

const systemPrompts = {
    heuristic: `你是一位针对大学生的苏格拉底式写作导师。你的核心目标是激发学生的深度思考和自我修正能力，而不是直接提供答案。你必须遵循以下步骤：1. 仔细阅读学生提供的文本。2. 从以下四个维度进行分析：论点清晰度 (Argument Clarity)、证据支持 (Evidential Support)、逻辑结构 (Logical Structure) 和语言表达 (Language Expression)。3. 针对你发现的主要问题，提出具体的、引导性的问题来启发学生。严禁直接给出修改建议或重写句子。4. 你的反馈必须使用中文，并在关键概念或引导性问题后用括号附上英文翻译。请以清晰的列表形式呈现你的反馈。`,
    instructive: `你是一位严谨的、面向大学生的写作批改助手。你的任务是精确地找出文本中的具体错误，并提供清晰的修改方案和解释。你必须遵循以下步骤：1. 逐句分析学生提供的文本，找出语法错误、拼写错误、不恰当的用词或句子结构问题。2. 对于每一个发现的错误，你必须按照以下固定格式进行反馈。3. 你的反馈和解释必须使用中文。固定反馈格式：\n- **原文 (Original):** [学生原句]\n- **建议 (Suggested):** [修改后句子]\n- **原因 (Reason):** [修改原因]`
};

async function logToAirtable(data) {
    const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Log`;
    try {
        await axios.post(airtableUrl, { records: [{ fields: data }] }, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Airtable logging successful for:', data.Participant_ID);
    } catch (error) {
        console.error('Airtable logging failed:', error.response ? error.response.data : error.message);
    }
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { participantId, group, inputText } = JSON.parse(event.body);
        const systemPrompt = systemPrompts[group];

        if (!systemPrompt) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid group specified.' }) };
        }

        // --- Zhipu AI API Call ---
        const zhipuApiKey = process.env.ZHIPU_API_KEY; // Let's use a specific name
        const token = generateToken(zhipuApiKey, 3600); // Generate a token valid for 1 hour

        const zhipuResponse = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
            model: "glm-4", // Using the best model
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: inputText }],
            temperature: group === 'heuristic' ? 0.7 : 0.2,
        }, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const aiFeedback = zhipuResponse.data.choices[0].message.content;

        logToAirtable({
            'Participant_ID': participantId,
            'Group': group,
            'Input_Text': inputText,
            'AI_Feedback': aiFeedback
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ feedback: aiFeedback })
        };

    } catch (error) {
        console.error('An error occurred:', error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An internal server error occurred.' })
        };
    }
};