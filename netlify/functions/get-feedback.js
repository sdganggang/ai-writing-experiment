// Import the Airtable library
const Airtable = require('airtable');

// Define system prompts for different groups
const systemPrompts = {
    heuristic: `You are a Socratic writing tutor for a university student. Your goal is to stimulate the student's deep thinking and self-correction abilities. You are strictly forbidden from giving direct answers, corrections, or rewritten text. You MUST guide the student by only asking probing and reflective questions.

    When you analyze the student's text, identify areas of weakness (e.g., unclear argument, weak evidence, awkward phrasing, potential logical fallacies). For each area, formulate a question to help the student think more deeply.
    
    Example interactions:
    - If the argument is weak, ask: "What is the core evidence supporting this particular claim? How might someone argue against this point?"
    - If a sentence is unclear, ask: "Could you try to explain the main idea of this sentence in a different way? What is the key message you want the reader to take away?"
    
    Do not praise or criticize. Only ask guiding questions to foster reflection.`,
    
    instructive: `You are a meticulous writing proofreader for a university student. Your only task is to identify grammatical errors, spelling mistakes, awkward phrasing, and unclear sentences. For each issue you find, you must provide a direct correction or a rewritten version of the sentence.

    You are strictly forbidden from asking questions, providing general advice, or discussing the content's ideas. Your feedback must be specific, actionable, and corrective.
    
    Format your feedback clearly, for example:
    - **Original:** "He go to the store yesterday."
      **Suggested:** "He went to the store yesterday."
    - **Original:** "The data which was collected shows a trend."
      **Suggested:** "The collected data shows a trend."
    
    Provide a list of these direct corrections.`
};

exports.handler = async function (event, context) {
    // 1. Check if the request method is POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        // 2. Parse the incoming data from the frontend
        const { participantId, group, inputText } = JSON.parse(event.body);

        // 3. Get the correct system prompt for the group
        const systemPrompt = systemPrompts[group];
        if (!systemPrompt) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid group specified.' }) };
        }

        // 4. Call the DeepSeek API
        const deepseekResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // IMPORTANT: Use environment variables for your API keys!
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: inputText }
                ],
                temperature: group === 'heuristic' ? 0.7 : 0.2, // Higher temp for more creative questions, lower for direct corrections
            })
        });

        if (!deepseekResponse.ok) {
            const errorData = await deepseekResponse.json();
            console.error('DeepSeek API Error:', errorData);
            throw new Error(`DeepSeek API Error: ${errorData.error.message}`);
        }

        const deepseekData = await deepseekResponse.json();
        const aiFeedback = deepseekData.choices[0].message.content;

        // 5. Log the data to Airtable
        try {
            const airtableBase = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
            await airtableBase('Log').create([
                {
                    fields: {
                        'Participant_ID': participantId,
                        'Group': group,
                        'Input_Text': inputText,
                        'AI_Feedback': aiFeedback
                    }
                }
            ]);
        } catch (airtableError) {
            // Log the Airtable error but don't fail the entire request.
            // The student should still get their feedback even if logging fails.
            console.error('Airtable logging failed:', airtableError);
        }

        // 6. Return the AI feedback to the frontend
        return {
            statusCode: 200,
            body: JSON.stringify({ feedback: aiFeedback })
        };

    } catch (error) {
        console.error('Server-side error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};