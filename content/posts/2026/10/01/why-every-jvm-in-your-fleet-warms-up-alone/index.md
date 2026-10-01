---
title: "Why Every JVM In Your Fleet Warms Up Alone"
date: "2026-10-01"
description: "Why you can't just copy a JIT-compiled method from one JVM to another: compiled code is a bet on one specific JVM's state. Identity, validity, and profitability all have to be checked before it's safe to reuse."
authors:
  - "jiri-holusa"
image: "foojay-header-part1-warms-up-alone.jpg"
categories:
  - "Java Core"
  - "Performance"
  - "JEPs"
related_posts:
  - "what-happens-when-10000-jvms-collaborate-in-one-production-environment"
  - "how-is-leyden-improving-java-performance-part-1-of-3"
  - "java-performance-ahead-of-time-versus-just-in-time"
  - "faster-java-warmup-crac-versus-readynow"
  - "analyzing-and-tuning-warm-up-of-the-jvm-with-azul-zulu-prime-builds-of-openjdk"
---

We live in a distributed systems world. We handle more traffic "simply" by adding more instances, or replicas, of the same service and then distribute the traffic between them.

The service ends up running on tens, hundreds or thousands of JVMs. Same JAR, same JDK, same instance type, same traffic shape. Instance 1 starts cold, spends its first minutes working out which of its several thousand methods are hot, and compiles them optimizing them specifically for the traffic observed. Instance 1000, starting a couple hours later, does exactly the same thing. From scratch, for the 1000th time.

None of that is a bug. It is how the JVM works, and it works that way for a good reason: the JIT compiler compiles what it observes, in the JVM where it observed it. But the waste is real, and the obvious question is hard to shake. Instance 1 already did this work. Why can't instance 1000 just take the answer?

The naive approach might be - just store the compiled code for each method somewhere and during the next start, feed that "somewhere" to the JVM and restore the already compiled code instead of doing it just-in-time, e.g. just by matching the method's fully qualified name. After all, it's a copy of the same JAR, same application, same traffic. How hard can it be?

In this post, you'll read about why it's actually not so simple. We'll cover:

* **What the compiler actually assumed.** The machine code a JIT emits is not just a translation of your bytecode. It is a bet on the state of one specific JVM at one specific moment, and that bet is exactly where the speed comes from.
* **The three problems you inherit the moment you try to move it.**
  * _Identity_. Which of this JVM's classes, fields and methods is the incoming code even talking about? A name is not the unique identifier you probably think it is.
  * _Validity_. Several thousand recorded assumptions per method, every single one of which has to hold, and you have to check them all in far less time than it would take to just compile the method yourself.
  * _Profitability_. Code can be provably correct and still be the wrong code for this instance.

That's this post. Later, in part 2, we'll get to the two ways out: how Project Leyden answers it, with local artifacts called ahead-of-time (AOT) caches built from a training run, and why we went the other way.

## Compiled code is a conditional artifact

In order to not get lost in this section, here's a spoiler alert: storing just JIT compiled code and then trying to naively match it by name to the same methods simply doesn't work - JIT compiled code is only valid together with assumptions, those assumptions need to be validated when restoring the code, and - there are a lot of assumptions. Let's deep dive into concrete examples.

Let's start with what a JIT compiler actually does, because "translates bytecode into machine code" is only a small part of it, and the part that matters least here.

A JIT compiler watches your program run and then bets on what it saw. Take this:

```java
Codec c = registry.lookup(name);
return c.decode(buf);
```

If `Codec` has exactly one loaded implementation at the moment the compiler runs, there is no reason to emit a virtual dispatch (i.e. deciding the method to be executed based on the actually used implementation). The compiler devirtualizes the call, inlines the body of `decode` straight into the caller, and then applies optimizations that weren't previously possible due to the call boundary - constant folding, dead branch elimination, register allocation through the inlined code and others. What comes out contains no dispatch and quite possibly no recognizable trace of `decode` at all.

The point is that the code is fast because of the observations, or assumptions, (i.e. only one `Codec` implementation observed) being made, not despite it.

Now let the application run a little longer. A request arrives in a format nobody has asked for yet, the registry loads a second `Codec`, and the assumption is broken. The machine code that assumed a single implementation is not merely suboptimal now, it is wrong, and it is wrong in the way that results in a crash rather than the way that shows up in a latency graph.

The JVM handles this every day and you never notice. It wrote the assumption down when it compiled the method, so when that second class loads it finds the affected code, throws it away, and falls back to the interpreter, rebuilding interpreter frames for any thread that happens to be executing inside that code at that exact moment. Then it recompiles, this time with a dispatch. That is deoptimization, and the reason the machinery exists at all is that optimized code is conditional by construction.

Here's the thing, though: your JVM already does all of this bookkeeping. Right now, in production, for every optimized method it has installed. That is what makes deoptimization possible in the first place, and the dependency tracking behind it is not a small system. So "you would have to record what the compiler assumed" is not the hard part, and it is not new. Your JVM has been doing it all along.

What changes when the code moves to a _different_ JVM isn't that a record suddenly becomes necessary. It's that the record stops being a private note to self. Inside one JVM, those assumptions are tracked against a world that same JVM controls, and watched for changes it will make itself. Send them somewhere else and every one of them turns into a claim about a process this JVM knows nothing about.

So what is actually in that record? Claims of this kind:

* class hierarchy relationships
* field offsets and types
* method bytecode and access flags
* constant values
* the targets of resolved calls

How long the list gets is partly a design decision. A fine-grained record produces a lot of small entries; in the implementation we'll look at in part 2, it runs to several thousand for a single method, and a coarser design would produce fewer. The count isn't the interesting part.

What is interesting is that if you look at that list, most of it appears to be static. Which interfaces a class implements, where a field sits inside an object, what bytecode a method contains: if both instances loaded a byte-identical class file, every one of those is guaranteed to agree. Checking them starts to look like paranoia.

And it would be, except for one thing. Nothing tells the receiving JVM that the two instances did load the same file. "It's the same application" is something you know, from your build and your deployment pipeline. The JVM has no access to that. Fingerprint the class file and you could establish it once, then stop checking those facts individually.

That's a real option, which makes the static half of the problem, at least in principle, a solved one. So look at what's left over.

A constant value doesn't have to be the same between two runs. A `static final` field initialized with the current date and time is a compile-time constant to a compiler that can see it, and the value it saw is not the value this instance has.

And then there's the one that isn't on that list at all, because it isn't a property of the code. It's a property of the JVM - nicest example being **class initialization state**. A class that has already been initialized needs no initialization check in the code that touches it, so the compiler doesn't emit one. Take that code, install it in a JVM where the class has not been initialized yet, and you have broken the program.

Same JAR, same JDK, same machine type, same traffic pattern. None of it helps. The class isn't initialized in the receiving instance because the path that would have initialized it simply hasn't run there yet. It's a younger process. Identical inputs do not give you identical runtime state, and no fingerprint will ever tell you otherwise.

That's the part that doesn't go away. And every entry in the record, static or not, is load-bearing for a piece of code that no longer contains the check that would have caught the problem.

In summary, the naive approach of just matching the compiled code based on fully-qualified name of a method breaks before it ever reaches the filesystem. Dumping the code cache saves the answers and throws away the questions. Machine code without the record of what it assumed is not a cache entry, it's a crash waiting for a class loader.

The approach has to change shape. You don't move compiled code, you move compiled code plus several thousand claims about the world. And the receiving JVM, by which we mean a fresh instance coming up somewhere in the fleet rather than a restart of the one that produced the code, has to check every single one of those claims against itself before it runs any of that code. Which brings us to a question that sounds like a formality and turns out to be another hard part: before you can check a claim about a field, you have to work out which field the claim is even talking about.

## Identity: what is this claim even about?

That checking work splits into three questions, and it's worth naming them before we start. Can this JVM tell what a claim is even _about_? Is the claim _true_ here? And if it's true, is the code it belongs to actually any _good_ for this instance? The first one is the one nobody expects to be a problem.

A single entry in the record looks roughly like this: the field `buffer` of `class com.example.Codec` sits at offset 40 and has type `byte[]`. To check it, this JVM needs to find its own `com.example.Codec` and go look. Finding a class by name is one method call, it's the obvious move, and it is the wrong thing to do.

A class name is not a unique identifier in a running JVM. A class is identified by its name and the class loader that defined it. Two loaders can each define a class called `com.example.Codec`, and those are two genuinely different classes: different fields at different offsets, different method bodies. If you have ever shipped a plugin system, run inside an application server, or had two modules each bundle their own version of the same library, you have had same-named classes coexisting in one JVM and never noticed, because the loaders kept them apart.

A lookup by name doesn't answer the question, it guesses at it. It would happily hand back the wrong `Codec`, we would verify our claim against a class that has nothing to do with the one the compiler saw, and every field offset in that machine code would then point somewhere plausible and wrong.

So names are out. What's left?

The answer is to stop looking things up, and start _deriving_ them instead.

Everything the record talks about gets a number of its own, meaningful only inside that record. Class 24. Field 100. Method 201. Those numbers aren't addresses in any JVM. They're local handles, and the job of the receiving JVM is to work out, one at a time, which real thing in _this_ process each handle points at.

A small set of them is unambiguous from the outset: the method whose code was requested, the class that declares it. Those are given. Everything else has to be reached from something already identified.

Here's the part that makes it work. Checking a claim and establishing identity are the same act. Say the record asserts that class 24 implements three interfaces, numbered 153, 173 and 69. To check that, you have to already know which live class 24 is. So you go to that class, look at the interfaces it actually implements, and compare. If they line up, two things just happened: the claim is verified, and you now know which live interfaces 153, 173 and 69 refer to. A later claim can talk about 153 and you'll know what it means.

Every check pays for itself by producing new identity, and the record is ordered so that this always works out: nothing is ever referred to before some earlier entry has pinned it down. The receiving JVM walks the list once, front to back.

Names do appear in all this, and they do useful work. Those interfaces are matched by name. But look at where the name is being used: not to search the JVM for a class called `Constable`, which is the ambiguous operation, but to pick the right one out of the interfaces of a class we have already identified. The structure gets you to the right neighbourhood, and only then does the name tell you which door.

Which is the useful way to think about the whole scheme. A name on its own is a postal address, and the same address exists in a hundred cities. What the record gives you instead is directions: start from the door you are already standing in, and every step from there is anchored to the step before it.

Which makes the whole thing a single pass: no searching, no probing, no backtracking. That's not an elegance argument. It matters enormously, and the next section explains why: the entire operation is running against a pretty tight time budget.

## Validity: all or nothing, on a strict budget

Identifying what a claim refers to is only the first half of the job. The check splits into two distinct stages: first resolution, which is everything the previous section described, and then verification, which is what happens once you actually have the thing in your hands.

Verification is the conceptually boring half. You found the field. The record says offset 40, type `byte[]`. Look at your own field: offset 40, type `byte[]`? Then that claim holds. Next one.

What's interesting is the standard it's held to. The acceptance criterion is absolute: every dependency must resolve, and every resolved dependency must match before the compilation can be applied. Not most of them, not the important-looking ones. All of them.

That sounds like paranoia until you remember what we established earlier. A broken assumption in optimized code is not a performance regression, it's a correctness failure, and the compiler has already deleted the checks that would have caught it. There's no such thing as a mostly-valid compiled method. You cannot install 90% of one and interpret the rest. It's the whole method or none of it, which means a single failed entry out of several thousand throws the entire compilation away.

Now count the work. Several thousand entries for one method. A starting instance wants a large number of methods, because that's the entire point. So the receiving JVM is performing millions of individual checks, and it's doing it during startup, which is already the most contended, least pleasant moment in a process's life: classes loading, the application's own initialization running, CPU quota tighter than it will ever be again.

And here's the constraint that shapes the whole design. All of this only makes sense if verifying a method is _dramatically_ cheaper than just compiling that method locally. If the two costs are comparable, you have built a slower JIT. So verification doesn't merely need to be correct, it needs to be correct at a cost that rounds to nothing next to optimizing compilation.

That is why the derivation scheme in the previous section looks the way it does. No searching for classes by name, no hash lookups, no probing, no retries, no backtracking. The records arrive in dependency order, the JVM walks them once, front to back, and each step either lands on exactly one entity or fails. A design that had to search for the right class would be perfectly correct and completely useless.

Failure, when it comes, has to be cheap too. A method whose record does not fully check out is simply discarded, and the JVM compiles it the way it always would have. That's what makes this safe to turn on: the worst case is not a crash and not a slow path, it's just an ordinary JVM doing ordinary JIT compilation. You lose the head start for that one method and nothing else.

Everything up to here has been about not being wrong. Which leaves the question that turns out to be the subtle one: the code can check out completely, every single claim verified, and still be the wrong code to install.

## Profitability: correct code that is still the wrong code

Everything so far has been about not being wrong. Verification answers the question "will this code break?", and it answers it absolutely: every claim holds, or the code goes in the bin.

There's a second question it doesn't answer at all. Will this code be _fast_ here?

Those look like the same question and they aren't, because compiled code carries two very different kinds of assumption. Some are facts about the JVM's structure: this field is at this offset, this class has this parent, this method has this bytecode. Those are checkable. You go and look, and the answer is yes or no.

The others are not facts about structure, they're _statistics about behaviour_. This branch was taken 98% of the time. This call site only ever saw one receiver type. This loop usually ran 12 times. This path was never executed at all, so let's not waste optimization effort on it. The compiler used those observations just as aggressively as it used the structural ones, and the speed of the resulting code depends on them just as heavily.

And here's the awkward part: there is nothing to check them against. A starting JVM has no profile. It hasn't run anything yet. That's the entire reason it wants somebody else's compiled code. So you can verify every structural claim in the record down to the last entry and still have no way whatsoever to know whether the behavioural assumptions hold, because the only thing that could tell you is the execution you're trying to skip.

Take the call site from earlier. In the instance that compiled it, `decode` only ever received one type, so the compiler emitted a fast path for that type with a guard and a slow fallback for anything else. Now install that code into an instance whose first traffic happens to hit a different codec. Every call fails the guard and takes the fallback. The code is completely correct. It is also slower than what a normal JIT would have produced for this instance, because a normal JIT would have watched this traffic and optimized for what it actually saw.

You might object, reasonably, that identical instances serving identical traffic should produce identical profiles. In steady state, largely true. But profitability is judged in the window where the instance is not in steady state. The first requests a fresh instance sees are health checks, connection setup, cache priming, a schema load, whatever the load balancer happens to route first. The producer's profile came from an hour of real traffic. The consumer's first seconds are not a sample of that hour, and those first seconds are exactly when the installed code is doing its job.

There's also an asymmetry in what being wrong costs you. A claim that fails verification costs almost nothing: throw the code away, compile normally, lose only the head start. Code that verifies and simply doesn't fit has already been installed and is already running, and it goes on running until something notices and replaces it.

OpenJDK is candid about exactly this in JEP 544. AOT code and JIT code can differ, it notes, because training runs and production runs can differ, and it closes the point with a line worth keeping: at run time the compilers can generate JIT code to replace AOT code "that fails to age well". Its stated assumption is that cached code benefits similar production runs "while not doing harm to divergent production runs, which can use JIT compilation to generate different code".

That's a fair argument, and it rests on machinery the JVM has always had. What it doesn't tell you is how long the window is between installing code that doesn't fit and running code that does.

So the problem is not only "is this code valid here". It's "which of the code I could send is actually worth sending". That's a prediction problem rather than a verification problem, and unlike verification, prediction has no absolute acceptance criterion to hide behind.

## What's next

That's the problem stated honestly: three questions, and only two of them have answers you can check.

In part 2 we will get concrete about the two ways out. First, Project Leyden, which sidesteps most of this by moving the work earlier in time rather than to another machine, and pays for that in the quality of the code it can generate. Then our own answer, which goes the other way: streaming compiled code out of a fleet of JVMs that are serving production traffic right now, into instances that are still starting up. That approach doesn't get to scope a single one of these three problems away, which is exactly why it took so long to build. We'll walk through what it actually does about each of them, and what it buys you.