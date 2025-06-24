// Use a robust, well-tested library for network requests
const axios = require('axios');

const systemPrompts = {
    heuristic: `你是一位针对大学生的苏格拉底式写作导师。你的核心目标是激发学生的深度思考和自我修正能力，而不是直接提供答案。你必须遵循以下步骤：1. 仔细阅读学生提供的文本。2. 从以下四个维度进行分析：论点清晰度 (Argument Clarity)、证据支持 (Evidential Support)、逻辑结构 (Logical Structure) 和语言表达 (Language Expression)。3. 针对你发现的主要问题，提出具体的、引导性的问题来启发学生。严禁直接给出修改建议或重写句子。4. 你的反馈必须使用中文，并在关键概念或引导性问题后用括号附上英文翻译。请以清晰的列表形式呈现你的反馈。`,
    instructive: `你是一位严谨的、面向大学生的写作批改助手。你的任务是精确地找出文本中的具体错误，并提供清晰的修改方案和解释。你必须遵循以下步骤：1. 逐句分析学生提供的文本，找出语法错误、拼写错误、不恰当的用词或句子结构问题。2. 对于每一个发现的错误，你必须按照以下固定格式进行反馈。3. 你的反馈和解释必须使用中文。固定反馈格式：\n- **原文 (Original):** [学生原句]\n- **建议 (Suggested):** [修改后句子]\n- **原因 (Reason):** [修改原因]`
};

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

        // --- Step 1: Get feedback from DeepSeek using axios ---
        const deepseekResponse = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-chat",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: inputText }],
            temperature: group === 'heuristic' ? 0.7 : 0.2,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            }
        });

        const aiFeedback = deepseekResponse.data.choices[0].message.content;

        // --- Step 2: Log data to Airtable using axios (awaiting completion) ---
        const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Log`;
        await axios.post(airtableUrl, {
            records: [{
                fields: {
                    'Participant_ID': participantId,
                    'Group': group,
                    'Input_Text': inputText,
                    'AI_Feedback': aiFeedback
                }
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Successfully fetched feedback and logged to Airtable.');

        // --- Step 3: Return the feedback to the user ---
        return {
            statusCode: 200,
            body: JSON.stringify({ feedback: aiFeedback })
        };

    } catch (error) {
        // Log detailed error information
        console.error('An error occurred:', error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An internal server error occurred.' })
        };
    }
};