// "use server";

// import { auth } from "../../auth";
// import { prisma } from "../../prisma";
// import Razorpay from "razorpay";
// import { v4 as uuidv4 } from "uuid";
// import crypto from 'crypto';
// import { pricingPlans } from "./pricing-constants";

// if (!process.env.RAZORPAY_KEY_SECRET) {
//   throw new Error("RAZORPAY_KEY_SECRET environment variable is not defined");
// }
// if (!process.env.RAZORPAY_KEY_ID) {
//   throw new Error("RAZORPAY_KEY_ID environment variable is not defined");
// }

// const razorpay = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET,
// });

// export const createOrder = async (key : string, paymentAmount : number , isAnnual : boolean) => {
//     console.log("createOrder called");
//   const session = await auth();
//   if (!session?.user?.id) {
//     return {
//       message: "User not logged in",
//       success: false,
//     };
//   }

//   console.log("User logged in");
//   console.log("Payment Amount : ", paymentAmount);
//     console.log("Key : ", key);
//     console.log("isAnnual : ", isAnnual);

//   // Find plan in pricing constants
//   const plan = pricingPlans.find(p => p.id === key);
//   if (!plan) {
//     return {
//       message: "Invalid plan",
//       success: false,
//     };
//   }

//   console.log("Plan found");

//   // Validate amount with database
//   const dbPlan = await prisma.subscriptionplans.findFirst({
//     where: {
//       planid: parseInt(key),
//       isactive: true,
//       ...(isAnnual 
//         ? { priceannually: paymentAmount }
//         : { pricemonthly: paymentAmount }
//       )
//     },
//   });

//   if (!dbPlan) {
//     return {
//       message: "Invalid subscription amount",
//       success: false,
//     };
//   }

//   const amount = paymentAmount;
//   const receipt = uuidv4().slice(0, 20);

//   try {
//     const order = await razorpay.orders.create({
//       amount: Math.round(amount * 100),
//       currency: "INR",
//       receipt: `receipt#${receipt}`,
//     });

//     return {
//       message: "Order created successfully",
//       order,
//       success: true,
//       planName: plan.name
//     };
//   } catch (error) {
//     console.error("Error creating order:", error);
//     return {
//       message: "Something went wrong",
//       success: false,
//     };
//   }
// };

// export async function verifyPayment(
//   orderId: string,
//   paymentId: string,
//   signature: string,
//   planId: string,
//   isAnnual: boolean
// ) {
//   const session = await auth();
//   if (!session?.user?.id) {
//     return {
//       message: "User not logged in",
//       success: false,
//     };
//   }

//   // Verify signature
//   const text = orderId + '|' + paymentId;
//   const generated_signature = crypto
//     .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
//     .update(text)
//     .digest('hex');

//   if (generated_signature !== signature) {
//     return {
//       message: "Invalid payment signature",
//       success: false,
//     };
//   }

//   const plan = await prisma.subscriptionplans.findUnique({
//     where: { planid: parseInt(planId) },
//   });

//   if (!plan) {
//     return {
//       message: "Plan not found",
//       success: false,
//     };
//   }

//   // Calculate expiry date based on plan duration and whether it's annual
//   const expiryDate = new Date();
//   expiryDate.setDate(
//     expiryDate.getDate() + (isAnnual ? plan.durationindays * 12 : plan.durationindays)
//   );

//   try {
//     await prisma.subscribedusers.create({
//       data: {
//         userid: session.user.id,
//         planid: parseInt(planId),
//         expirydate: expiryDate,
//         isactive: true,
//         autorenew: false,
//       },
//     });

//     return {
//       message: "Subscription activated successfully",
//       success: true,
//     };
//   } catch (error) {
//     console.error("Error saving subscription:", error);
//     return {
//       message: "Error activating subscription",
//       success: false,
//     };
//   }
// }

"use server";

import { auth } from "../../auth";
import { prisma } from "../../prisma";
import Razorpay from "razorpay";
import { v4 as uuidv4 } from "uuid";
import crypto from 'crypto';
import { pricingPlans } from "./pricing-constants";

if (!process.env.RAZORPAY_KEY_SECRET) {
  throw new Error("RAZORPAY_KEY_SECRET environment variable is not defined");
}
if (!process.env.RAZORPAY_KEY_ID) {
  throw new Error("RAZORPAY_KEY_ID environment variable is not defined");
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export const createOrder = async (key: string, paymentAmount: number, isAnnual: boolean) => {
  console.log("createOrder called");
  const session = await auth();
  if (!session?.user?.id) {
    console.log("User not logged in");
    return {
      message: "User not logged in",
      success: false,
    };
  }

  console.log("User logged in");
  console.log("Payment Amount:", paymentAmount);
  console.log("Key:", key);
  console.log("isAnnual:", isAnnual);

  // Find plan in pricing constants
  const plan = pricingPlans.find(p => p.id === key);
  if (!plan) {
    console.log("Invalid plan");
    return {
      message: "Invalid plan",
      success: false,
    };
  }

  console.log("Plan found:", plan.name);

  // Validate amount with database
  const dbPlan = await prisma.subscriptionplans.findFirst({
    where: {
      planid: parseInt(key),
      isactive: true,
      ...(isAnnual
        ? { priceannually: paymentAmount }
        : { pricemonthly: paymentAmount }
      )
    },
  });

  if (!dbPlan) {
    console.log("Invalid subscription amount");
    return {
      message: "Invalid subscription amount",
      success: false,
    };
  }

  console.log("Plan validated with database");

  const amount = paymentAmount;
  const receipt = uuidv4().slice(0, 20);

  try {
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `receipt#${receipt}`,
    });

    console.log("Order created successfully:", order);
    return {
      message: "Order created successfully",
      order,
      success: true,
      planName: plan.name
    };
  } catch (error) {
    console.error("Error creating order:", error);
    return {
      message: "Something went wrong",
      success: false,
    };
  }
};

export async function verifyPayment(
  orderId: string,
  paymentId: string,
  signature: any,
  planId: string,
  isAnnual: boolean
) {
  console.log("verifyPayment called");
  console.log("Order ID:", orderId);
  console.log("Payment ID:", paymentId);
  console.log("Signature:", signature);
  console.log("Plan ID:", planId);
  console.log("Is Annual:", isAnnual);

  const session = await auth();
  if (!session?.user?.id) {
    console.log("User not logged in");
    return {
      message: "User not logged in",
      success: false,
    };
  }

  console.log("User logged in:", session.user.id);

  // Verify signature
  const text = orderId + '|' + paymentId;
  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(text)
    .digest('hex');

  console.log("Generated signature:", generated_signature);
  console.log("Received signature:", signature);

  if (generated_signature !== signature) {
    console.log("Invalid payment signature");
    return {
      message: "Invalid payment signature",
      success: false,
    };
  }

  console.log("Signature verified successfully");

  const plan = await prisma.subscriptionplans.findUnique({
    where: { planid: parseInt(planId) },
  });

  if (!plan) {
    console.log("Plan not found");
    return {
      message: "Plan not found",
      success: false,
    };
  }

  console.log("Plan found:", plan);

  // Calculate expiry date based on plan duration and whether it's annual
  const expiryDate = new Date();
  expiryDate.setDate(
    expiryDate.getDate() + (isAnnual ? plan.durationindays * 12 : plan.durationindays)
  );

  console.log("Expiry date calculated:", expiryDate);

  try {
    await prisma.subscribedusers.create({
      data: {
        userid: session.user.id,
        planid: parseInt(planId),
        expirydate: expiryDate,
        isactive: true,
        autorenew: false,
      },
    });

    console.log("Subscription activated successfully");
    return {
      message: "Subscription activated successfully",
      success: true,
    };
  } catch (error) {
    console.error("Error saving subscription:", error);
    return {
      message: "Error activating subscription",
      success: false,
    };
  }
}